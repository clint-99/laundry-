begin;
create extension if not exists pgcrypto;
create type public.app_role as enum ('owner','rider');
create type public.order_status as enum ('pending_approval','placed','picked_up','weighed','at_shop','ready','delivered','cancelled');
create table public.profiles(id uuid primary key references auth.users(id) on delete cascade, role public.app_role not null, full_name text not null check(length(full_name) between 1 and 120), phone text, active boolean not null default true, created_at timestamptz not null default now());
create table public.settings(
 id int primary key default 1 check(id=1), business_name text not null default '{{BUSINESS_NAME}}', currency_symbol text not null default '₱', timezone text not null default 'Asia/Manila', max_kg_per_load numeric not null default 8 check(max_kg_per_load>0), default_delivery_days int not null default 1 check(default_delivery_days between 0 and 30), same_day_cutoff time not null default '15:00', daily_pickup_capacity_loads int not null default 40 check(daily_pickup_capacity_loads>0), service_areas text[] not null default '{}', booking_open boolean not null default true, hotline text default '{{HOTLINE}}', facebook_url text default '{{FACEBOOK_PAGE_URL}}', rider_daily_default numeric not null default 0 check(rider_daily_default>=0), rider_batch_default numeric not null default 0 check(rider_batch_default>=0), message_templates jsonb not null default '{"booking_link":"Hi {name}! Book your next pickup here: {link}","confirmation":"Hi {name}, order {order} is confirmed for {date}.","pickup_reminder":"Hi {name}, please have your bag {bag} ready for pickup on {date}.","ready":"Hi {name}, order {order} is ready for delivery.","delivered":"Hi {name}, order {order} has been delivered. Thank you!"}'
);
insert into public.settings default values;
create table public.services(id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 120), price_per_load numeric(10,2) not null check(price_per_load>=0), active boolean not null default true, sort int not null default 0);
create table public.shops(id uuid primary key default gen_random_uuid(),name text not null,phone text,address text,cost_per_load numeric(10,2) not null check(cost_per_load>=0),capacity_loads int not null default 6 check(capacity_loads>0),active boolean not null default true);
-- Avoid assuming the installation schema of pgcrypto (Supabase often uses extensions).
create function public.new_booking_token() returns text language plpgsql volatile set search_path='' as $$begin if current_user not in ('postgres','service_role') then perform public.require_owner();end if;return replace(gen_random_uuid()::text,'-','')||substr(replace(gen_random_uuid()::text,'-',''),1,16);end$$;
create sequence public.customer_seq;
create sequence public.order_seq;
create function public.next_code(p_sequence regclass,p_prefix text) returns text language plpgsql set search_path='' as $$declare n text;begin if current_user not in ('postgres','service_role') then perform public.require_owner();end if;n:=nextval(p_sequence)::text;return p_prefix||lpad(n,greatest(4,length(n)),'0');end$$;
create table public.customers(
 id uuid primary key default gen_random_uuid(),bag_code text unique not null default public.next_code('public.customer_seq','CU-'),full_name text not null check(length(full_name) between 1 and 120),phone text not null unique check(phone ~ '^\+639[0-9]{9}$'),area text not null,address text not null,landmark text,lat double precision check(lat between -90 and 90),lng double precision check(lng between -180 and 180),booking_token text unique not null default public.new_booking_token(),notes text,blocked boolean not null default false,created_at timestamptz not null default now()
);
create table public.orders(
 id uuid primary key default gen_random_uuid(),order_no text unique not null default public.next_code('public.order_seq','LD-'),customer_id uuid not null references public.customers(id),service_id uuid not null references public.services(id),loads int not null check(loads between 1 and 20),bags int not null default 1 check(bags between 1 and 20),price_per_load numeric(10,2) not null check(price_per_load>=0),total_price numeric(10,2) generated always as(loads*price_per_load) stored,shop_id uuid references public.shops(id),shop_cost_per_load numeric(10,2) check(shop_cost_per_load>=0),status public.order_status not null default 'placed',source text not null default 'owner' check(source in ('owner','book_again','book_new')),channel text,pickup_date date not null,pickup_window text not null default 'Morning' check(pickup_window in ('Morning','Afternoon','Evening')),due_date date not null,deliver_to_other boolean not null default false,delivery_address text,delivery_area text,notes text,actual_kg numeric check(actual_kg>=0),picked_up_at timestamptz,delivered_at timestamptz,cancelled_reason text,created_at timestamptz not null default now(),check(not deliver_to_other or (length(trim(delivery_address))>0 and length(trim(delivery_area))>0))
);
create index on public.orders(status);create index on public.orders(customer_id);create index on public.orders(pickup_date);create index on public.orders(shop_id);
create table public.order_events(id bigserial primary key,order_id uuid not null references public.orders(id),status public.order_status,note text,kind text not null default 'status' check(kind in ('status','problem','note')),by_user uuid references auth.users(id),at timestamptz not null default now());
create index on public.order_events(order_id,at);
create table public.rider_pay(id uuid primary key default gen_random_uuid(),date date not null,rider uuid not null references public.profiles(id),pay_type text not null check(pay_type in ('daily','batch')),amount numeric(10,2) not null check(amount>=0),stops int not null default 0 check(stops>=0),notes text);
create table public.booking_requests(id uuid primary key,fingerprint text not null,result jsonb not null);
create table public.rate_limits(key text primary key,window_start timestamptz not null,count int not null);
create table public.rider_actions(id uuid primary key,by_user uuid not null references auth.users(id),order_id uuid not null references public.orders(id),from_status public.order_status not null,to_status public.order_status not null,at timestamptz not null default now(),event_id bigint references public.order_events(id),undone boolean not null default false);
create function public.is_role(r public.app_role) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where id=auth.uid() and role=r and active)$$;
create function public.require_owner() returns void language plpgsql stable security definer set search_path='' as $$begin if not public.is_role('owner') then raise exception 'Not allowed'; end if; end$$;
create function public.settings_check() returns trigger language plpgsql set search_path='' as $$begin if not exists(select 1 from pg_timezone_names where name=new.timezone) then raise exception 'Unknown timezone'; end if; return new; end$$;
create trigger settings_check before update on public.settings for each row execute function public.settings_check();
create function public.orders_before_write() returns trigger language plpgsql security definer set search_path='' as $$
declare s public.settings; v_price numeric; v_cost numeric;
begin
 select * into s from public.settings where id=1;
 if tg_op='INSERT' or new.service_id is distinct from old.service_id then
   select price_per_load into v_price from public.services where id=new.service_id and active;
   if not found then raise exception 'Service is unavailable'; end if;
   new.price_per_load:=v_price;
 else new.price_per_load:=old.price_per_load; end if;
 if tg_op='INSERT' then new.due_date:=coalesce(new.due_date,new.pickup_date+s.default_delivery_days); end if;
 if new.shop_id is null then new.shop_cost_per_load:=null;
 elsif tg_op='INSERT' or new.shop_id is distinct from old.shop_id then
   select cost_per_load into v_cost from public.shops where id=new.shop_id and active;
   if not found then raise exception 'Shop is unavailable'; end if;
   new.shop_cost_per_load:=v_cost;
 else new.shop_cost_per_load:=old.shop_cost_per_load; end if;
 if tg_op='UPDATE' and new.status is distinct from old.status and coalesce(current_setting('app.status_note',true),'')='' then raise exception 'Use the status action with an audit note'; end if;
 if new.status='cancelled' and coalesce(length(trim(new.cancelled_reason)),0)=0 then raise exception 'Cancellation reason required'; end if;
 if new.status='at_shop' and new.shop_id is null then raise exception 'Assign a shop before drop-off'; end if;
 if tg_op='UPDATE' and new.status is distinct from old.status then
   if new.status='picked_up' then new.picked_up_at:=now(); end if;
   if new.status='placed' then new.picked_up_at:=null; end if;
   if new.status='delivered' then new.delivered_at:=now(); elsif old.status='delivered' then new.delivered_at:=null; end if;
 end if;
 return new;
end$$;
create trigger orders_before before insert or update on public.orders for each row execute function public.orders_before_write();
create function public.orders_log() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_op='INSERT' or new.status is distinct from old.status then
 insert into public.order_events(order_id,status,by_user,note) values(new.id,new.status,auth.uid(),nullif(current_setting('app.status_note',true),''));
 elsif new is distinct from old then insert into public.order_events(order_id,status,kind,by_user,note) values(new.id,new.status,'note',auth.uid(),'Order details updated'); end if;
 return null;
end$$;
create trigger orders_log after insert or update on public.orders for each row execute function public.orders_log();
create function public.owner_status(p_order uuid,p_to public.order_status,p_note text) returns public.orders language plpgsql security definer set search_path='' as $$declare o public.orders; begin
 perform public.require_owner(); if length(trim(coalesce(p_note,''))) not between 1 and 500 then raise exception 'Add an audit note'; end if;
 perform set_config('app.status_note',p_note,true);
 update public.orders set status=p_to,cancelled_reason=case when p_to='cancelled' then p_note else cancelled_reason end where id=p_order returning * into o;
 if not found then raise exception 'Order not found'; end if; return o;
end$$;
create function public.reset_booking_link(p_customer uuid) returns text language plpgsql security definer set search_path='' as $$declare t text;begin perform public.require_owner();update public.customers set booking_token=public.new_booking_token() where id=p_customer returning booking_token into t;return t;end$$;
create function public.rider_tasks() returns table(order_id uuid,order_no text,bag_code text,status public.order_status,customer_name text,phone text,area text,address text,landmark text,lat double precision,lng double precision,loads int,bags int,pickup_date date,pickup_window text,due_date date,notes text,shop_name text,shop_phone text,shop_address text,delivered_at timestamptz,latest_problem text)
language sql stable security definer set search_path='' as $$
 select o.id,o.order_no,c.bag_code,o.status,c.full_name,c.phone,
 case when o.status='placed' or not o.deliver_to_other then c.area else o.delivery_area end,
 case when o.status='placed' or not o.deliver_to_other then c.address else o.delivery_address end,
 case when o.status='placed' or not o.deliver_to_other then c.landmark else null end,
 case when o.status='placed' or not o.deliver_to_other then c.lat else null end,
 case when o.status='placed' or not o.deliver_to_other then c.lng else null end,
 o.loads,o.bags,o.pickup_date,o.pickup_window,o.due_date,o.notes,s.name,s.phone,s.address,o.delivered_at,
 (select e.note from public.order_events e where e.order_id=o.id and e.kind='problem' order by e.at desc,e.id desc limit 1)
 from public.orders o join public.customers c on c.id=o.customer_id left join public.shops s on s.id=o.shop_id
 where (public.is_role('rider') or public.is_role('owner')) and (o.status in ('placed','picked_up','weighed','at_shop','ready') or(o.status='delivered' and o.delivered_at>now()-interval '60 seconds'))
 order by c.area,o.pickup_date,case o.pickup_window when 'Morning' then 1 when 'Afternoon' then 2 else 3 end
$$;
-- Every rider tap has a client-generated UUID for retry-safe, durable offline sync.
create function public.rider_mark(p_order uuid,p_to public.order_status,p_action uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders; a public.rider_actions;
begin
 if not(public.is_role('rider') or public.is_role('owner')) then raise exception 'Not allowed'; end if;
 select * into o from public.orders where id=p_order for update; if not found then raise exception 'Order not found'; end if;
 select * into a from public.rider_actions where id=p_action;
 if found then if a.by_user<>auth.uid() or a.order_id<>p_order or a.to_status<>p_to then raise exception 'Action conflict'; end if;return jsonb_build_object('status',o.status,'action_id',a.id,'undone',a.undone); end if;
 if not((o.status='placed' and p_to='picked_up') or(o.status in ('picked_up','weighed') and p_to='at_shop') or(o.status='ready' and p_to='delivered')) then raise exception 'Invalid status change'; end if;
 insert into public.rider_actions(id,by_user,order_id,from_status,to_status) values(p_action,auth.uid(),p_order,o.status,p_to);
 perform set_config('app.status_note','Rider action',true);
 update public.orders set status=p_to where id=p_order returning * into o;
 update public.rider_actions set event_id=(select max(id) from public.order_events where order_id=p_order and kind='status') where id=p_action;
 return jsonb_build_object('status',o.status,'action_id',p_action);
end$$;
-- Undo covers ALL rider taps, including shop drop-off, and is tied to the same user and action.
create function public.rider_undo(p_action uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.rider_actions;o public.orders;
begin
 if not(public.is_role('rider') or public.is_role('owner')) then raise exception 'Not allowed'; end if;
 select * into a from public.rider_actions where id=p_action;
 if not found or a.by_user<>auth.uid() then raise exception 'Action not found'; end if;
 select * into o from public.orders where id=a.order_id for update;
 select * into a from public.rider_actions where id=p_action for update;
 if a.undone then return jsonb_build_object('status',o.status); end if;
 if a.at<=now()-interval '60 seconds' or o.status<>a.to_status or exists(select 1 from public.order_events where order_id=o.id and kind='status' and id>a.event_id) then raise exception 'Undo expired or order changed'; end if;
 perform set_config('app.status_note','Rider undo',true);
 update public.orders set status=a.from_status where id=o.id returning * into o;
 update public.rider_actions set undone=true where id=a.id;
 return jsonb_build_object('status',o.status);
end$$;
create function public.rider_report(p_order uuid,p_reason text,p_action uuid) returns void language plpgsql security definer set search_path='' as $$begin
 if not(public.is_role('rider') or public.is_role('owner')) then raise exception 'Not allowed'; end if;
 if length(trim(coalesce(p_reason,''))) not between 1 and 300 then raise exception 'Add a short reason'; end if;
 perform 1 from public.orders where id=p_order and status in ('placed','picked_up','weighed','at_shop','ready');if not found then raise exception 'Task unavailable';end if;
 -- Use a separate deduplication namespace in rate_limits, which riders cannot access.
 insert into public.rate_limits(key,window_start,count) values('report:'||auth.uid()||':'||p_action,now(),1) on conflict do nothing;
 if found then insert into public.order_events(order_id,kind,note,by_user) values(p_order,'problem',p_reason,auth.uid());end if;
end$$;
-- Atomic rate limiter; only Edge Functions using service_role may call it.
create function public.consume_rate(p_key text,p_limit int,p_seconds int) returns boolean language plpgsql security definer set search_path='' as $$declare n int;begin
 insert into public.rate_limits as r(key,window_start,count) values(p_key,now(),1) on conflict(key) do update set count=case when r.window_start<=now()-make_interval(secs=>p_seconds) then 1 else r.count+1 end,window_start=case when r.window_start<=now()-make_interval(secs=>p_seconds) then now() else r.window_start end returning count into n;return n<=p_limit;
end$$;
create function public.public_config() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.settings; dates jsonb; services jsonb; today date;
begin
 select * into s from public.settings where id=1; today:=(now() at time zone s.timezone)::date;
 select jsonb_agg(jsonb_build_object('date',d::date,'capacity_left',greatest(0,s.daily_pickup_capacity_loads-used),'bookable',s.booking_open and used<s.daily_pickup_capacity_loads and(d::date>today or(now() at time zone s.timezone)::time<s.same_day_cutoff)) order by d) into dates
 from (select d,coalesce((select sum(loads) from public.orders where pickup_date=d::date and status<>'cancelled'),0) used from generate_series(today,today+6,interval '1 day') d) days;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'price_per_load',price_per_load) order by sort,name),'[]'::jsonb) into services from public.services where active;
 return jsonb_build_object('business_name',s.business_name,'hotline',s.hotline,'facebook_url',s.facebook_url,'currency_symbol',s.currency_symbol,'timezone',s.timezone,'max_kg_per_load',s.max_kg_per_load,'service_areas',s.service_areas,'booking_open',s.booking_open,'services',services,'dates',dates);
end$$;
create function public.booking_lookup(p_token text) returns jsonb language plpgsql stable security definer set search_path='' as $$declare c public.customers;o public.orders;a public.orders;begin
 select * into c from public.customers where booking_token=p_token and not blocked;if not found then raise exception 'Link not valid';end if;
 select * into o from public.orders where customer_id=c.id order by created_at desc limit 1;
 select * into a from public.orders where customer_id=c.id and status not in ('delivered','cancelled') order by created_at desc limit 1;
 return jsonb_build_object('first_name',split_part(c.full_name,' ',1),'area',c.area,'loads',coalesce(o.loads,1),'service_id',o.service_id,'active_order',case when a.id is not null then jsonb_build_object('status',a.status,'order_no',a.order_no,'due_date',a.due_date) else null end);
end$$;
-- Lock the singleton settings row before customer/capacity decisions, serializing public bookings.
create function public.create_booking(p_data jsonb,p_returning boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.settings;c public.customers;o public.orders;v_date date;v_loads int;v_service uuid;v_existing boolean:=false;v_today date;v_request public.booking_requests;v_result jsonb;
begin
 select * into s from public.settings where id=1 for update;
 if p_data->>'request_id' is not null then
 select * into v_request from public.booking_requests where id=(p_data->>'request_id')::uuid;
 if found then if v_request.fingerprint<>md5(p_data::text) then raise exception 'Request changed. Reload and try again.';end if;return v_request.result;end if;
 end if;
 if not s.booking_open then raise exception 'Bookings are closed. Please message us.';end if;
 v_date:=(p_data->>'pickup_date')::date;v_loads:=(p_data->>'loads')::int;v_service:=(p_data->>'service_id')::uuid;v_today:=(now() at time zone s.timezone)::date;
 if v_date is null or v_date<v_today or v_date>v_today+6 or(v_date=v_today and(now() at time zone s.timezone)::time>=s.same_day_cutoff) then raise exception 'Choose an available pickup date';end if;
 if v_loads is null or v_loads not between 1 and 20 then raise exception 'Choose 1 to 20 loads';end if;
 if coalesce(p_data->>'pickup_window','') not in ('Morning','Afternoon','Evening') then raise exception 'Choose a pickup window';end if;
 if not exists(select 1 from public.services where id=v_service and active) then raise exception 'Service unavailable';end if;
 if v_loads+coalesce((select sum(loads) from public.orders where pickup_date=v_date and status<>'cancelled'),0)>s.daily_pickup_capacity_loads then raise exception 'That date is full. Choose another day.';end if;
 if p_returning then
   select * into c from public.customers where booking_token=p_data->>'token' and not blocked for update;
   if not found then raise exception 'Link not valid';end if;
   if exists(select 1 from public.orders where customer_id=c.id and status not in ('delivered','cancelled')) then raise exception 'You already have an active order. Message us to make changes.';end if;
 else
   if coalesce(p_data->>'consent','')<>'true' then raise exception 'Consent required';end if;
   if coalesce(p_data->>'phone','') !~ '^\+639[0-9]{9}$' or length(trim(coalesce(p_data->>'name',''))) not between 1 and 120 or length(trim(coalesce(p_data->>'address',''))) not between 1 and 500 then raise exception 'Check your contact details';end if;
   if not(coalesce(p_data->>'area','')=any(s.service_areas)) then raise exception 'Please choose a service area';end if;
   if coalesce(p_data->>'deliver_to_other','false')='true' and (length(trim(coalesce(p_data->>'delivery_address',''))) not between 1 and 500 or not(coalesce(p_data->>'delivery_area','')=any(s.service_areas))) then raise exception 'Check the delivery address';end if;
   select * into c from public.customers where phone=p_data->>'phone' for update;v_existing:=found;
   if not found then
     insert into public.customers(full_name,phone,area,address,landmark,lat,lng) values(p_data->>'name',p_data->>'phone',p_data->>'area',p_data->>'address',left(p_data->>'landmark',300),(p_data->>'lat')::double precision,(p_data->>'lng')::double precision) returning * into c;
   end if;
   -- Never overwrite a known customer's address or expose account existence. Owner reviews the submitted details.
 end if;
 insert into public.orders(customer_id,service_id,loads,bags,status,source,pickup_date,pickup_window,deliver_to_other,delivery_address,delivery_area,notes,channel)
 values(c.id,v_service,v_loads,1,case when p_returning then 'placed'::public.order_status else 'pending_approval'::public.order_status end,case when p_returning then 'book_again' else 'book_new' end,v_date,p_data->>'pickup_window',case when p_returning then false else coalesce((p_data->>'deliver_to_other')::boolean,false) end,case when p_returning then null else p_data->>'delivery_address' end,case when p_returning then null else p_data->>'delivery_area' end,left(p_data->>'notes',1000),'Website') returning * into o;
 if not p_returning then insert into public.order_events(order_id,kind,note) values(o.id,'note','New booking details for review: '||jsonb_build_object('name',p_data->>'name','phone',p_data->>'phone','area',p_data->>'area','address',p_data->>'address','landmark',p_data->>'landmark','existing_phone_review',v_existing,'blocked_review',c.blocked)::text);end if;
 v_result:=jsonb_build_object('order_no',o.order_no,'total',o.total_price,'pickup_date',o.pickup_date,'pickup_window',o.pickup_window,'status',o.status);
 if p_data->>'request_id' is not null then insert into public.booking_requests(id,fingerprint,result) values((p_data->>'request_id')::uuid,md5(p_data::text),v_result);end if;
 return v_result;
end$$;
create function public.track_booking(p_order text,p_last4 text) returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object('status',o.status,'due_date',o.due_date) from public.orders o join public.customers c on c.id=o.customer_id where o.order_no=p_order and right(c.phone,4)=p_last4 and p_last4 ~ '^[0-9]{4}$'$$;
create function public.owner_report(p_from date,p_to date,p_group text default 'day') returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform public.require_owner();
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>3660 or p_group not in ('day','week','month') then raise exception 'Choose a valid report range (up to 10 years)';end if;
 with delivered as (
 select o.*,c.area,s.name shop_name,(o.delivered_at at time zone cfg.timezone)::date report_date,
 case when o.source='owner' then coalesce(o.channel,'Owner') else o.source end report_channel
 from public.orders o join public.customers c on c.id=o.customer_id left join public.shops s on s.id=o.shop_id cross join public.settings cfg
 where cfg.id=1 and o.status='delivered' and (o.delivered_at at time zone cfg.timezone)::date between p_from and p_to
 ), pay as(select * from public.rider_pay where date between p_from and p_to),
 totals as(select count(*) orders,coalesce(sum(loads),0) loads,coalesce(sum(total_price),0) revenue,coalesce(sum(loads*shop_cost_per_load),0) shop_cost,coalesce(bool_or(shop_cost_per_load is null),false) missing_shop_cost from delivered),
 costs as(select coalesce(sum(amount),0) rider_cost from pay),
 order_periods as(select date_trunc(p_group,report_date::timestamp)::date period,count(*) orders,sum(loads) loads,sum(total_price) revenue,coalesce(sum(loads*shop_cost_per_load),0) shop_cost from delivered group by 1),
 pay_periods as(select date_trunc(p_group,date::timestamp)::date period,sum(amount) rider_cost from pay group by 1),
 periods as(select coalesce(o.period,p.period) period,coalesce(o.orders,0) orders,coalesce(o.loads,0) loads,coalesce(o.revenue,0) revenue,coalesce(o.shop_cost,0) shop_cost,coalesce(p.rider_cost,0) rider_cost from order_periods o full join pay_periods p on p.period=o.period),
 grouped as(select 'shop' kind,coalesce(shop_name,'Unassigned') label,count(*) orders,sum(loads) loads,sum(total_price) revenue,coalesce(sum(loads*shop_cost_per_load),0) shop_cost from delivered group by shop_name
 union all select 'area',area,count(*),sum(loads),sum(total_price),coalesce(sum(loads*shop_cost_per_load),0) from delivered group by area
 union all select 'channel',report_channel,count(*),sum(loads),sum(total_price),coalesce(sum(loads*shop_cost_per_load),0) from delivered group by report_channel)
 select jsonb_build_object('totals',jsonb_build_object('orders',t.orders,'loads',t.loads,'revenue',t.revenue,'shop_cost',t.shop_cost,'rider_cost',c.rider_cost,'margin',t.revenue-t.shop_cost-c.rider_cost,'margin_per_load',case when t.loads>0 then(t.revenue-t.shop_cost-c.rider_cost)/t.loads else 0 end,'missing_shop_cost',t.missing_shop_cost,'break_even_loads',case when t.revenue>t.shop_cost and t.loads>0 then ceil((c.rider_cost/(p_to-p_from+1))/((t.revenue-t.shop_cost)/t.loads)) else null end),
 'periods',coalesce((select jsonb_agg(jsonb_build_object('period',period,'orders',orders,'loads',loads,'revenue',revenue,'shop_cost',shop_cost,'rider_cost',rider_cost,'margin',revenue-shop_cost-rider_cost,'margin_per_load',case when loads>0 then(revenue-shop_cost-rider_cost)/loads else 0 end) order by period) from periods),'[]'::jsonb),
 'groups',coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'label',label,'orders',orders,'loads',loads,'revenue',revenue,'shop_cost',shop_cost,'contribution',revenue-shop_cost) order by kind,label) from grouped),'[]'::jsonb)) into result from totals t cross join costs c;
 return result;
end$$;
-- All data objects use RLS. No anonymous grants, no rider table rows except their own profile.
do $$declare t text;begin foreach t in array array['profiles','settings','services','shops','customers','orders','order_events','rider_pay','rate_limits','rider_actions','booking_requests'] loop execute format('alter table public.%I enable row level security',t);if t not in ('rate_limits','rider_actions','booking_requests') then execute format('create policy owner_all on public.%I for all to authenticated using(public.is_role(''owner'')) with check(public.is_role(''owner''))',t);end if;end loop;end$$;
create policy self_read on public.profiles for select to authenticated using(id=auth.uid());
revoke all on all tables in schema public from anon,authenticated;
revoke all on all sequences in schema public from anon,authenticated;
revoke all on all functions in schema public from public,anon,authenticated;
grant usage on schema public to anon,authenticated,service_role;
grant select,insert,update,delete on public.profiles,public.services,public.shops,public.customers,public.rider_pay to authenticated;
grant select,update on public.settings to authenticated;
grant select,insert,update on public.orders to authenticated;
grant select on public.order_events to authenticated;
grant usage,select on public.customer_seq,public.order_seq to authenticated;
grant execute on function public.owner_report(date,date,text),public.new_booking_token(),public.next_code(regclass,text),public.is_role(public.app_role),public.require_owner(),public.owner_status(uuid,public.order_status,text),public.reset_booking_link(uuid),public.rider_tasks(),public.rider_mark(uuid,public.order_status,uuid),public.rider_undo(uuid),public.rider_report(uuid,text,uuid) to authenticated;
grant all on all tables in schema public to service_role;grant all on all sequences in schema public to service_role;
grant execute on function public.consume_rate(text,int,int),public.public_config(),public.booking_lookup(text),public.create_booking(jsonb,boolean),public.track_booking(text,text) to service_role;
-- New objects must opt in explicitly.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke all on tables from anon,authenticated;
alter publication supabase_realtime add table public.orders,public.customers,public.order_events;
commit;

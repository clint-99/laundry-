-- OPTIONAL DEMO DATA. Do not run against an established business database.
insert into public.services(name,price_per_load) values ('Wash, dry & fold',190);
insert into public.shops(name,phone,address,cost_per_load,capacity_loads) values ('Demo Partner Laundry','+639171111111','Sample shop address — replace before launch',125,6);
insert into public.customers(full_name,phone,area,address,landmark) values ('Demo Customer','+639179999999','Sample Area A','Sample building, Unit 1','Demo only — delete this customer before launch');
-- Example names, not real service coverage. Owner must replace them in Settings.
update public.settings set service_areas=array['Sample Area A','Sample Area B'] where id=1;

ALTER PUBLICATION supabase_realtime ADD TABLE public.photo_products;
ALTER TABLE public.photo_products REPLICA IDENTITY FULL;
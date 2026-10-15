-- ================================================================================
-- MIFOS SYSTEM - MIGRATION 005: PACKET STICKER QR CODES FOR VAULT AUDIT
-- ================================================================================
-- Run this script in the Supabase SQL Editor to add the packet_qr column to pawns table.

ALTER TABLE public.pawns 
ADD COLUMN IF NOT EXISTS packet_qr TEXT;

CREATE INDEX IF NOT EXISTS idx_pawns_packet_qr ON public.pawns(packet_qr);

COMMENT ON COLUMN public.pawns.packet_qr IS 'Stores the scanned QR/barcode string from the physical packet sticker';

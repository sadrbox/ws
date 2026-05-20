-- Add legal_address and actual_address to ContactType enum
ALTER TYPE "ContactType" ADD VALUE IF NOT EXISTS 'legal_address';
ALTER TYPE "ContactType" ADD VALUE IF NOT EXISTS 'actual_address';

-- Papel "master": o dono do CRM, acima dos administradores.
--
-- Só ACRESCENTA um valor ao tipo. Nada é removido ou alterado.

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'MASTER';


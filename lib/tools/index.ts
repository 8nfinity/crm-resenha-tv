import {
  buscarConversas,
  historicoContato,
  leadsEsquecidos,
  leadsMaisQuentes,
  listarLeads,
} from "./leads";
import { metricasFunil, relatorioAtividades } from "./metrics";

/**
 * Registro das ferramentas expostas ao Claude.
 *
 * Todas são SOMENTE LEITURA. O Claude analisa o funil e recomenda; quem move
 * card é você. Se um dia houver ferramenta de escrita, ela precisa de uma
 * decisão explícita — um modelo movendo leads sozinho, com base numa leitura
 * errada de uma conversa, faz estrago silencioso no histórico.
 */
export const TOOLS = [
  leadsMaisQuentes,
  listarLeads,
  leadsEsquecidos,
  metricasFunil,
  relatorioAtividades,
  historicoContato,
  buscarConversas,
] as const;

export type Tool = (typeof TOOLS)[number];

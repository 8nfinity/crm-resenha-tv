import type { ScoreFactor } from "@/lib/scoring";
import type { SinalAtividades } from "@/lib/atividades";

/** O que o kanban precisa saber de um card. Serializável para o cliente. */
export type DealCard = {
  id: string;
  stageId: string;
  title: string;
  score: number;
  scoreSummary: string;
  scoreFactors: ScoreFactor[];
  value: number | null;
  contact: {
    id: string;
    name: string;
    phone: string | null;
    profilePicUrl: string | null;
  };
  /** Pessoa do time responsável pelo lead. */
  owner: { id: string; name: string } | null;
  /** De qual número conectado veio este lead. */
  account: {
    id: string;
    label: string;
    color: string;
  };
  lastInboundAt: string | null;
  lastInteractionAt: string | null;
  enteredStageAt: string;
  daysInStage: number;
  lastMessagePreview: string | null;
  openActivities: number;
  /**
   * A atividade em aberto que manda no ícone do card: a de prazo mais antigo
   * (se houver atrasada, é ela). Nula quando o lead não tem nada marcado.
   */
  proximaAtividade: { nome: string; dueAt: string | null } | null;
  /** Quantas atividades em aberto já passaram do prazo. */
  atrasadas: number;
  /** O ícone calculado no servidor; a tela recalcula pelo relógio depois de abrir. */
  sinal: SinalAtividades;
  /** Em Ganho ou Perdido: negócio fechado, sem ícone de atividade. */
  fechado: boolean;
  /** Valores dos campos que voce definiu, indexados pelo id do campo. */
  customValues: Record<string, string | number | null>;
};

export type StageColumn = {
  id: string;
  pipelineId: string;
  name: string;
  order: number;
  color: string;
  isWon: boolean;
  isLost: boolean;
};

/** Formato gravado em `Deal.scoreFactors`. */
export type StoredScoreFactors = {
  summary: string;
  factors: ScoreFactor[];
};

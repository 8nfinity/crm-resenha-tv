import type { ScoreFactor } from "@/lib/scoring";

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
  /** Valores dos campos que voce definiu, indexados pelo id do campo. */
  customValues: Record<string, string | number | null>;
};

export type StageColumn = {
  id: string;
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

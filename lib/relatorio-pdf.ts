import type { jsPDF as JsPDF } from "jspdf";
import type {
  ActivityReport,
  FollowUpsFeitos,
  FunnelMetrics,
  RelatorioTempoResposta,
} from "@/lib/metrics";
import { descreverPeriodo, rotuloJanela } from "@/lib/periodo";
import { formatarMinutos, SILENCIO_QUE_ABRE_CONVERSA_H } from "@/lib/tempo-resposta";

/**
 * Relatório de métricas em PDF, na identidade visual Biomech.
 *
 * Roda no navegador (só no clique): os números são exatamente os da tela, sem
 * uma segunda consulta que poderia trazer valores ligeiramente diferentes.
 *
 * Fundo escuro de propósito — é a identidade do sistema e o relatório circula
 * mais em tela (WhatsApp, e-mail) do que impresso.
 */

export type DadosRelatorio = {
  funil: FunnelMetrics;
  atividades: ActivityReport;
  resposta: RelatorioTempoResposta;
  followUps: FollowUpsFeitos;
};

type RGB = [number, number, number];

const COR = {
  fundo: [5, 15, 10] as RGB,
  grade: [11, 30, 20] as RGB,
  card: [10, 26, 18] as RGB,
  card2: [16, 38, 26] as RGB,
  borda: [28, 61, 43] as RGB,
  verde: [47, 227, 140] as RGB,
  verdeEscuro: [11, 61, 37] as RGB,
  amarelo: [242, 212, 23] as RGB,
  texto: [234, 252, 241] as RGB,
  suave: [141, 181, 160] as RGB,
  quente: [255, 122, 89] as RGB,
  sobreVerde: [4, 19, 11] as RGB,
};

const FONTE = "Montserrat";
const MARGEM = 36;

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const horas = (h: number | null) => {
  if (h === null) return "—";
  if (h < 24) return `${Math.round(h)} h`;
  return `${(h / 24).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias`;
};

async function base64De(url: string): Promise<string> {
  const buf = await fetch(url).then((r) => {
    if (!r.ok) throw new Error(`não achei ${url}`);
    return r.arrayBuffer();
  });
  // Em blocos: montar a string de uma vez estoura a pilha com arquivos de 450 KB.
  const bytes = new Uint8Array(buf);
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binario);
}

/**
 * Registra a Montserrat. Se o download falhar, o relatório sai em Helvetica
 * em vez de não sair — a fonte é acabamento, os números são o que importa.
 */
async function carregarFontes(doc: JsPDF): Promise<string> {
  try {
    const [regular, semibold, black] = await Promise.all([
      base64De("/fonts/Montserrat-Regular.ttf"),
      base64De("/fonts/Montserrat-SemiBold.ttf"),
      base64De("/fonts/Montserrat-Black.ttf"),
    ]);
    doc.addFileToVFS("Montserrat-Regular.ttf", regular);
    doc.addFileToVFS("Montserrat-SemiBold.ttf", semibold);
    doc.addFileToVFS("Montserrat-Black.ttf", black);
    doc.addFont("Montserrat-Regular.ttf", FONTE, "normal");
    doc.addFont("Montserrat-SemiBold.ttf", FONTE, "semibold");
    // "bold" é o nome que as tabelas (autoTable) entendem; aqui ele é o Black.
    doc.addFont("Montserrat-Black.ttf", FONTE, "bold");
    return FONTE;
  } catch {
    return "helvetica";
  }
}

/** Monta e baixa o PDF. */
export async function gerarRelatorioPdf(dados: DadosRelatorio) {
  const { doc, nomeArquivo } = await montarRelatorioPdf(dados);
  doc.save(nomeArquivo);
}

/** Só monta — separado para dar para conferir o resultado fora do navegador. */
export async function montarRelatorioPdf({ funil, atividades, resposta, followUps }: DadosRelatorio) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const [fonte, logo] = await Promise.all([
    carregarFontes(doc),
    base64De("/brand/selo.png").catch(() => null),
  ]);
  const semibold = fonte === FONTE ? "semibold" : "bold";

  const L = doc.internal.pageSize.getWidth();
  const A = doc.internal.pageSize.getHeight();
  const util = L - MARGEM * 2;
  let y = MARGEM;

  // ── Primitivas ─────────────────────────────────────────────────────────────

  const cor = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
  const preencher = (c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
  const tracar = (c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);
  const letra = (estilo: "normal" | "semibold" | "bold", tamanho: number) => {
    doc.setFont(fonte, estilo === "semibold" ? semibold : estilo);
    doc.setFontSize(tamanho);
  };

  // Fundo em cada página, uma vez só. As tabelas criam páginas sozinhas; o
  // registro evita repintar (e apagar) uma página que já tem conteúdo.
  const pintadas = new Set<number>();
  function pintarFundo() {
    const pagina = doc.getCurrentPageInfo().pageNumber;
    if (pintadas.has(pagina)) return;
    pintadas.add(pagina);
    preencher(COR.fundo);
    doc.rect(0, 0, L, A, "F");
    tracar(COR.grade);
    doc.setLineWidth(0.4);
    for (let gx = 0; gx < L; gx += 36) doc.line(gx, 0, gx, A);
    for (let gy = 0; gy < A; gy += 36) doc.line(0, gy, L, gy);
  }

  function novaPagina() {
    doc.addPage();
    pintarFundo();
    y = MARGEM;
  }

  /** Garante espaço; se não couber, continua na próxima página. */
  function caber(altura: number) {
    if (y + altura > A - 48) novaPagina();
  }

  function card(x: number, cy: number, w: number, h: number, fundo: RGB = COR.card) {
    preencher(fundo);
    tracar(COR.verde);
    doc.setLineWidth(0.8);
    doc.roundedRect(x, cy, w, h, 12, 12, "FD");
    // O triângulo amarelo no canto, assinatura dos cards da Biomech.
    preencher(COR.amarelo);
    doc.triangle(x + w, cy + h - 18, x + w, cy + h, x + w - 18, cy + h, "F");
  }

  function secao(titulo: string, descricao?: string) {
    caber(descricao ? 60 : 44);
    y += 10;
    preencher(COR.amarelo);
    doc.rect(MARGEM, y - 9, 3, 12, "F");
    letra("bold", 12);
    cor(COR.texto);
    doc.text(titulo.toUpperCase(), MARGEM + 10, y + 1);
    y += 14;
    if (descricao) {
      letra("normal", 8);
      cor(COR.suave);
      const linhas = doc.splitTextToSize(descricao, util);
      doc.text(linhas, MARGEM, y);
      y += linhas.length * 10 + 4;
    }
    y += 6;
  }

  /** Linha de indicadores: rótulo pequeno, número grande, legenda. */
  function indicadores(
    itens: { rotulo: string; valor: string; legenda?: string; tom?: RGB }[],
  ) {
    const h = 66;
    caber(h + 12);
    const gap = 10;
    const w = (util - gap * (itens.length - 1)) / itens.length;
    itens.forEach((it, i) => {
      const x = MARGEM + i * (w + gap);
      card(x, y, w, h);
      letra("normal", 7.5);
      cor(COR.suave);
      doc.text(it.rotulo, x + 12, y + 17);
      letra("bold", 18);
      cor(it.tom ?? COR.texto);
      doc.text(it.valor, x + 12, y + 40);
      if (it.legenda) {
        letra("normal", 6.5);
        cor(COR.suave);
        doc.text(doc.splitTextToSize(it.legenda, w - 30)[0], x + 12, y + 55);
      }
    });
    y += h + 12;
  }

  /** Barras verticais de uma série só: valor em cima, rótulo embaixo. */
  function barras(
    x: number,
    by: number,
    w: number,
    h: number,
    itens: { rotulo: string; valor: number; destaque?: RGB }[],
  ) {
    const max = Math.max(1, ...itens.map((i) => i.valor));
    const gap = 6;
    const bw = (w - gap * (itens.length - 1)) / itens.length;
    const areaTopo = by + 14;
    const areaAltura = h - 14 - 24;

    itens.forEach((it, i) => {
      const bx = x + i * (bw + gap);
      // Trilho: a altura toda, para comparar barras vazias com cheias.
      preencher(COR.card2);
      doc.roundedRect(bx, areaTopo, bw, areaAltura, 4, 4, "F");
      const bh = it.valor > 0 ? Math.max((it.valor / max) * areaAltura, 5) : 0;
      if (bh > 0) {
        preencher(it.destaque ?? COR.verde);
        doc.roundedRect(bx, areaTopo + areaAltura - bh, bw, bh, 4, 4, "F");
      }
      letra("bold", 8);
      cor(COR.texto);
      doc.text(String(it.valor), bx + bw / 2, areaTopo - 4, { align: "center" });
      letra("normal", 6);
      cor(COR.suave);
      const rotulo = doc.splitTextToSize(it.rotulo, bw + 4).slice(0, 2);
      doc.text(rotulo, bx + bw / 2, areaTopo + areaAltura + 10, { align: "center" });
    });
  }

  const estiloTabela = {
    theme: "plain" as const,
    styles: {
      font: fonte,
      fontSize: 8,
      textColor: COR.texto,
      fillColor: COR.card,
      lineColor: COR.borda,
      lineWidth: { bottom: 0.5 },
      cellPadding: { top: 6, bottom: 6, left: 8, right: 8 },
    },
    headStyles: {
      fillColor: COR.verde,
      textColor: COR.sobreVerde,
      fontStyle: "bold" as const,
      fontSize: 7.5,
    },
    alternateRowStyles: { fillColor: COR.card2 },
    margin: { left: MARGEM, right: MARGEM, top: MARGEM, bottom: 48 },
    willDrawPage: () => pintarFundo(),
    // Colunas de número alinham à direita; o título delas acompanha, senão o
    // cabeçalho fica de um lado e o valor do outro.
    didParseCell: (d: { section: string; column: { index: number }; cell: { styles: { halign: string } } }) => {
      if (d.section === "head" && d.column.index > 0) d.cell.styles.halign = "right";
    },
  };

  const fimDaTabela = () =>
    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  // ── Cabeçalho ──────────────────────────────────────────────────────────────

  pintarFundo();

  if (logo) doc.addImage(logo, "PNG", MARGEM, y, 58, 58);
  const tx = MARGEM + (logo ? 72 : 0);

  letra("bold", 22);
  cor(COR.texto);
  doc.text("RELATÓRIO DE MÉTRICAS", tx, y + 24);
  cor(COR.verde);
  doc.text("BIOMECH", tx, y + 50);

  const agora = new Date();
  const dataStr = agora.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  letra("semibold", 9);
  cor(COR.texto);
  doc.text(descreverPeriodo(funil.dias), L - MARGEM, y + 20, { align: "right" });
  letra("normal", 8);
  cor(COR.suave);
  doc.text(`Gerado em ${dataStr}`, L - MARGEM, y + 34, { align: "right" });
  doc.text("Instituto Biomech · CRM", L - MARGEM, y + 46, { align: "right" });

  y += 72;
  preencher(COR.amarelo);
  doc.rect(MARGEM, y, 70, 3, "F");
  y += 18;

  // ── Resumo do funil ────────────────────────────────────────────────────────

  secao("Resumo do período");
  indicadores([
    { rotulo: "Novos leads", valor: String(funil.novos), legenda: "entraram no funil" },
    { rotulo: "Ganhos", valor: String(funil.ganhos), legenda: "negócios fechados", tom: COR.verde },
    { rotulo: "Perdidos", valor: String(funil.perdidos), legenda: "saíram do funil" },
    { rotulo: "Conversão geral", valor: pct(funil.conversaoGeral), legenda: "ganhos ÷ novos leads" },
  ]);

  // ── Follow-ups feitos ──────────────────────────────────────────────────────

  secao(
    "Follow-ups feitos",
    "Concluídos em cada janela, pela data em que foram marcados como feitos. Hoje conta desde a meia-noite.",
  );
  indicadores(
    followUps.janelas.map((j) => ({
      rotulo: rotuloJanela(j.dias),
      valor: String(j.feitos),
      legenda:
        j.dias === 1
          ? "desde 00:00"
          : `≈ ${(j.feitos / j.dias).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} por dia`,
      tom: COR.verde,
    })),
  );
  indicadores([
    { rotulo: "Agendados", valor: String(followUps.agendados), legenda: "em aberto, com data" },
    {
      rotulo: "Atrasados",
      valor: String(followUps.atrasados),
      legenda: "prazo passou e não foi feito",
      tom: followUps.atrasados > 0 ? COR.quente : undefined,
    },
  ]);
  if (followUps.porVendedor.length > 0) {
    caber(60);
    autoTable(doc, {
      ...estiloTabela,
      startY: y,
      head: [["Vendedor (número)", ...followUps.janelas.map((j) => rotuloJanela(j.dias))]],
      body: followUps.porVendedor.map((v) => [v.nome, ...v.feitos.map(String)]),
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
    });
    y = fimDaTabela() + 14;
  }

  // ── Tempo de resposta ──────────────────────────────────────────────────────

  const p = resposta.primeira;
  secao(
    "Tempo de resposta do vendedor",
    `Quanto o lead espera pela resposta. "Primeira resposta" é quando ele começa uma conversa ou volta ` +
      `depois de ${SILENCIO_QUE_ABRE_CONVERSA_H} h de silêncio. Valores em mediana: uma resposta dada ` +
      `dias depois não distorce o retrato do dia a dia.`,
  );

  if (p.conversas === 0 && resposta.duranteConversa.conversas === 0) {
    letra("normal", 9);
    cor(COR.suave);
    doc.text("Nenhuma mensagem de lead no período.", MARGEM, y + 4);
    y += 20;
  } else {
    indicadores([
      {
        rotulo: "Primeira resposta",
        valor: formatarMinutos(p.medianaMin),
        legenda: `mediana de ${p.respondidas} respostas`,
        tom: COR.verde,
      },
      { rotulo: "Em até 5 minutos", valor: pct(p.ate5Min), legenda: `em até 1 h: ${pct(p.ate1h)}` },
      {
        rotulo: "Sem resposta",
        valor: String(p.semResposta),
        legenda:
          p.maiorEsperaMin !== null
            ? `mais antigo espera há ${formatarMinutos(p.maiorEsperaMin)}`
            : "nenhum lead esperando",
        tom: p.semResposta > 0 ? COR.quente : undefined,
      },
      {
        rotulo: "Durante a conversa",
        valor: formatarMinutos(resposta.duranteConversa.medianaMin),
        legenda: "mediana no meio do papo",
      },
    ]);

    const hGrafico = 150;
    caber(hGrafico + 12);
    card(MARGEM, y, util, hGrafico);
    letra("bold", 8);
    cor(COR.suave);
    doc.text("PRIMEIRAS RESPOSTAS POR FAIXA DE TEMPO", MARGEM + 14, y + 18);
    barras(
      MARGEM + 14,
      y + 28,
      util - 40,
      hGrafico - 36,
      resposta.faixasPrimeira.map((f) => ({ rotulo: f.rotulo, valor: f.quantidade })),
    );
    y += hGrafico + 12;

    if (resposta.porVendedor.length > 0) {
      caber(60);
      autoTable(doc, {
        ...estiloTabela,
        startY: y,
        head: [["Vendedor (número)", "1ª resposta", "Até 5 min", "90% em até", "Sem resposta", "No papo"]],
        body: resposta.porVendedor.map((v) => [
          v.nome,
          formatarMinutos(v.primeira.medianaMin),
          pct(v.primeira.ate5Min),
          formatarMinutos(v.primeira.p90Min),
          String(v.primeira.semResposta),
          formatarMinutos(v.duranteConversa.medianaMin),
        ]),
        columnStyles: {
          1: { halign: "right", textColor: COR.verde, fontStyle: "bold" },
          2: { halign: "right" },
          3: { halign: "right" },
          4: { halign: "right" },
          5: { halign: "right", textColor: COR.suave },
        },
      });
      y = fimDaTabela() + 14;
    }
  }

  // ── Fluxo do funil ─────────────────────────────────────────────────────────

  const ativos = funil.estagios
    .filter((e) => !e.isWon && !e.isLost)
    .reduce((s, e) => s + e.agora, 0);

  // Título, números e gráfico na mesma página: separados, o gráfico fica
  // órfão no topo da página seguinte sem dizer o que mostra.
  caber(60 + 78 + (funil.estagios.length > 0 ? 202 : 0));
  secao("Fluxo do funil", "Leads distintos que passaram por cada estágio no período.");
  indicadores([
    { rotulo: "Entraram", valor: String(funil.novos) },
    { rotulo: "Em andamento agora", valor: String(ativos) },
    { rotulo: "Ganhos", valor: String(funil.ganhos), tom: COR.verde },
  ]);

  if (funil.estagios.length > 0) {
    const hFluxo = 190;
    caber(hFluxo + 12);
    card(MARGEM, y, util, hFluxo, COR.fundo);
    barras(
      MARGEM + 14,
      y + 14,
      util - 40,
      hFluxo - 24,
      funil.estagios.map((e) => ({
        rotulo: e.nome,
        valor: e.chegaram,
        destaque: e.isLost ? COR.quente : undefined,
      })),
    );
    y += hFluxo + 12;
  }

  if (funil.gargalo) {
    caber(40);
    preencher(COR.card);
    tracar(COR.amarelo);
    doc.setLineWidth(0.8);
    doc.roundedRect(MARGEM, y, util, 30, 8, 8, "FD");
    letra("semibold", 8.5);
    cor(COR.amarelo);
    doc.text(
      `Gargalo: ${funil.gargalo.nome} — os leads ficam em média ${horas(funil.gargalo.horas)} nesse estágio antes de avançar.`,
      MARGEM + 12,
      y + 19,
      { maxWidth: util - 24 },
    );
    y += 42;
  }

  // ── Conversão entre estágios ───────────────────────────────────────────────

  const conversoes = funil.estagios.filter((e) => e.conversao !== null && !e.isLost);
  secao(
    "Conversão entre estágios",
    "Quantos dos que chegaram ao estágio anterior também chegaram a este.",
  );
  if (conversoes.length === 0) {
    letra("normal", 9);
    cor(COR.suave);
    doc.text("Ainda não há passagens entre estágios no período.", MARGEM, y + 4);
    y += 20;
  } else {
    const linha = 22;
    const h = conversoes.length * linha + 20;
    caber(h + 12);
    card(MARGEM, y, util, h);
    // Depois do trilho: o percentual e, alinhado à direita, "N leads".
    const trilhoX = MARGEM + 150;
    const trilhoW = util - 150 - 120;
    conversoes.forEach((e, i) => {
      const ly = y + 14 + i * linha;
      letra("semibold", 8);
      cor(COR.texto);
      doc.text(doc.splitTextToSize(e.nome, 130)[0], MARGEM + 14, ly + 9);
      preencher(COR.card2);
      doc.roundedRect(trilhoX, ly + 2, trilhoW, 9, 4.5, 4.5, "F");
      const v = Math.min(Math.max(e.conversao ?? 0, 0), 1);
      if (v > 0) {
        preencher(COR.verde);
        doc.roundedRect(trilhoX, ly + 2, Math.max(trilhoW * v, 9), 9, 4.5, 4.5, "F");
      }
      letra("bold", 8.5);
      cor(COR.verde);
      doc.text(pct(e.conversao), trilhoX + trilhoW + 12, ly + 10);
      letra("normal", 6.5);
      cor(COR.suave);
      doc.text(`${e.chegaram} leads`, L - MARGEM - 26, ly + 10, { align: "right" });
    });
    y += h + 12;
  }

  // ── Detalhe por estágio ────────────────────────────────────────────────────

  // Tabelas curtas vão inteiras para a próxima página em vez de partir em
  // duas; só uma tabela maior que a página deixa a quebra por conta do autoTable.
  const alturaTabela = (linhas: number) => 80 + (linhas + 1) * 22;

  caber(Math.min(alturaTabela(funil.estagios.length), A - 120));
  secao(
    "Detalhe por estágio",
    '"Passaram" conta leads distintos que cruzaram o estágio no período, e não quem está parado ' +
      "nele agora. Um lead que passou por Reunião e já avançou continua contando na Reunião.",
  );
  if (funil.estagios.length === 0) {
    letra("normal", 9);
    cor(COR.suave);
    doc.text("Nenhum estágio configurado.", MARGEM, y + 4);
    y += 20;
  } else {
    autoTable(doc, {
      ...estiloTabela,
      startY: y,
      head: [["Estágio", "Passaram", "Conversão", "Estão agora", "Tempo médio"]],
      body: funil.estagios.map((e) => [
        e.nome,
        String(e.chegaram),
        pct(e.conversao),
        String(e.agora),
        horas(e.horasMedias),
      ]),
      columnStyles: {
        1: { halign: "right" },
        2: { halign: "right", textColor: COR.verde },
        3: { halign: "right" },
        4: { halign: "right", textColor: COR.suave },
      },
    });
    y = fimDaTabela() + 14;
  }

  // ── Atividades ─────────────────────────────────────────────────────────────

  caber(alturaTabela(atividades.temRegistro ? atividades.porTipo.length : 1));
  secao(
    "Atividades",
    atividades.temRegistro
      ? `Total feito no período: ${atividades.totalFeitas} · leads distintos com reunião: ${atividades.leadsComReuniao}` +
          (atividades.atrasadas > 0 ? ` · ${atividades.atrasadas} atrasadas` : "")
      : undefined,
  );
  if (!atividades.temRegistro) {
    letra("normal", 9);
    cor(COR.suave);
    doc.text(
      doc.splitTextToSize(
        "Nenhuma atividade registrada no período. Marque follow-ups e reuniões na aba \"atividades\" de cada card.",
        util,
      ),
      MARGEM,
      y + 4,
    );
    y += 28;
  } else {
    autoTable(doc, {
      ...estiloTabela,
      startY: y,
      head: [["Tipo", "Feitas no período", "Em aberto"]],
      body: atividades.porTipo.map((t) => [t.label, String(t.feitas), String(t.abertas)]),
      columnStyles: {
        1: { halign: "right", textColor: COR.verde },
        2: { halign: "right", textColor: COR.suave },
      },
    });
    y = fimDaTabela() + 14;
  }

  // ── Rodapé em todas as páginas ─────────────────────────────────────────────

  const paginas = doc.getNumberOfPages();
  for (let pg = 1; pg <= paginas; pg++) {
    doc.setPage(pg);
    tracar(COR.borda);
    doc.setLineWidth(0.5);
    doc.line(MARGEM, A - 34, L - MARGEM, A - 34);
    letra("semibold", 7);
    cor(COR.verde);
    doc.text("INSTITUTO BIOMECH", MARGEM, A - 20);
    letra("normal", 7);
    cor(COR.suave);
    doc.text("Avaliação biomecânica e fisioterapia · CRM", MARGEM + 84, A - 20);
    doc.text(`página ${pg} de ${paginas}`, L - MARGEM, A - 20, { align: "right" });
  }

  return {
    doc,
    nomeArquivo: `metricas-biomech-${funil.dias}dias-${agora.toISOString().slice(0, 10)}.pdf`,
  };
}

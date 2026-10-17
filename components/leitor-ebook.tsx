"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Loader2, Maximize2, Minimize2 } from "lucide-react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { cn } from "@/lib/utils";

/**
 * Leitor de e-book do playbook.
 *
 * O PDF não abre no visualizador do navegador (barra cinza, zoom, miniaturas):
 * cada página é desenhada pelo pdf.js e mostrada como um livro aberto — capa
 * sozinha, depois duas páginas lado a lado na tela grande, uma no celular.
 * Vira página com as setas, o teclado, um toque na metade do livro ou
 * arrastando o dedo. E lembra onde você parou.
 */

type Pdfjs = typeof import("pdfjs-dist");
let pdfjsCarregando: Promise<Pdfjs> | null = null;

/** Carrega o pdf.js só quando um e-book é aberto (ele é grande). */
function carregarPdfjs(): Promise<Pdfjs> {
  pdfjsCarregando ??= import("pdfjs-dist").then((m) => {
    // Arquivos servidos pelo próprio CRM (scripts/copiar-pdfjs.mjs).
    m.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
    return m;
  });
  return pdfjsCarregando;
}

function lerPosicao(chave: string): number {
  try {
    return Number(localStorage.getItem(chave)) || 1;
  } catch {
    return 1;
  }
}

function guardarPosicao(chave: string, pagina: number) {
  try {
    localStorage.setItem(chave, String(pagina));
  } catch {
    // Navegador sem armazenamento: só não lembra a página.
  }
}

export function LeitorEbook({ id, titulo }: { id: string; titulo: string }) {
  const url = `/api/playbook/arquivos/${id}`;
  const chave = `ebook:${id}`;
  const moldura = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [erro, setErro] = useState(false);
  const [total, setTotal] = useState(0);
  // Largura ÷ altura da capa: define o formato do livro.
  const [proporcao, setProporcao] = useState(0.707);
  const [atual, setAtual] = useState(1);
  const [direcao, setDirecao] = useState<"frente" | "tras">("frente");
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [telaCheia, setTelaCheia] = useState(false);

  // Abre o PDF.
  useEffect(() => {
    let vivo = true;
    // Destruir a tarefa de abertura fecha o documento e o worker junto.
    let abertura: PDFDocumentLoadingTask | null = null;
    setPdf(null);
    setErro(false);

    void carregarPdfjs()
      .then(async (pdfjs) => {
        abertura = pdfjs.getDocument({
          url,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          wasmUrl: "/pdfjs/wasm/",
          iccUrl: "/pdfjs/iccs/",
        });
        const doc = await abertura.promise;
        if (!vivo) return;
        const capa = (await doc.getPage(1)).getViewport({ scale: 1 });
        setProporcao(capa.width / capa.height);
        setTotal(doc.numPages);
        setAtual(Math.min(lerPosicao(chave), doc.numPages));
        setPdf(doc);
      })
      .catch(() => vivo && setErro(true));

    return () => {
      vivo = false;
      void abertura?.destroy();
    };
  }, [url, chave]);

  // Mede o espaço disponível (muda ao redimensionar e na tela cheia).
  useEffect(() => {
    const el = moldura.current;
    if (!el) return;
    const medir = () => setArea({ w: el.clientWidth, h: window.innerHeight });
    medir();
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    window.addEventListener("resize", medir);
    return () => {
      obs.disconnect();
      window.removeEventListener("resize", medir);
    };
  }, [telaCheia, pdf]);

  // Duas páginas lado a lado quando cabe e o livro é "em pé".
  const dupla = area.w >= 760 && proporcao < 1.1;

  // Livro aberto: a capa fica sozinha; depois, pares 2–3, 4–5…
  const inicio = dupla && atual > 1 && atual % 2 === 1 ? atual - 1 : atual;
  const visiveis = dupla && inicio > 1 ? [inicio, inicio + 1].filter((p) => p <= total) : [inicio];

  const ir = useCallback(
    (pagina: number, sentido?: "frente" | "tras") => {
      if (!total) return;
      const alvo = Math.max(1, Math.min(total, pagina));
      if (alvo === inicio) return;
      setDirecao(sentido ?? (alvo > inicio ? "frente" : "tras"));
      setAtual(alvo);
      guardarPosicao(chave, alvo);
    },
    [total, inicio, chave],
  );

  const proxima = useCallback(() => ir(dupla ? (inicio === 1 ? 2 : inicio + 2) : inicio + 1, "frente"), [ir, dupla, inicio]);
  const anterior = useCallback(() => ir(dupla ? (inicio === 2 ? 1 : inicio - 2) : inicio - 1, "tras"), [ir, dupla, inicio]);
  const temProxima = inicio + visiveis.length - 1 < total;
  const temAnterior = inicio > 1;

  // Teclado: setas, Page Up/Down, Home/End — menos quando digitando (busca).
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      if (alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.isContentEditable)) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") proxima();
      else if (e.key === "ArrowLeft" || e.key === "PageUp") anterior();
      else if (e.key === "Home") ir(1);
      else if (e.key === "End") ir(total);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [proxima, anterior, ir, total]);

  // Tela cheia do próprio leitor (não a do navegador de PDF).
  useEffect(() => {
    const mudou = () => setTelaCheia(document.fullscreenElement === moldura.current);
    document.addEventListener("fullscreenchange", mudou);
    return () => document.removeEventListener("fullscreenchange", mudou);
  }, []);

  function alternarTelaCheia() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void moldura.current?.requestFullscreen?.().catch(() => {});
  }

  // Arrastar o dedo vira a página.
  const toque = useRef<number | null>(null);

  // Tamanho de cada página: cabe na largura e na altura disponíveis.
  const altDisponivel = telaCheia ? area.h - 110 : Math.max(360, Math.min(area.h - 250, 1000));
  const larguraPagina = Math.max(
    120,
    Math.floor(Math.min(dupla ? (area.w - 56) / 2 : area.w - 32, altDisponivel * proporcao)),
  );
  const alturaPagina = Math.floor(larguraPagina / proporcao);

  const rotuloPaginas =
    visiveis.length === 2 ? `Páginas ${visiveis[0]}–${visiveis[1]} de ${total}` : `Página ${visiveis[0]} de ${total}`;

  return (
    <div
      ref={moldura}
      className={cn(
        "relative flex select-none flex-col items-center",
        telaCheia
          ? "h-screen justify-center bg-[var(--color-bg)] px-4"
          : "rounded-lg bg-[radial-gradient(ellipse_at_center,rgb(47_227_140/0.07),transparent_70%)] px-2 pb-4 pt-6",
      )}
    >
      {erro ? (
        <div className="flex flex-col items-center gap-3 py-24 text-center">
          <p className="text-sm text-[var(--color-muted)]">Não consegui abrir este e-book aqui.</p>
          <a href={`${url}?baixar=1`} className="rounded-full border px-4 py-2 text-sm hover:text-[var(--color-accent)]">
            Baixar o arquivo
          </a>
        </div>
      ) : !pdf || area.w === 0 ? (
        <div className="flex items-center gap-2 py-32 text-sm text-[var(--color-muted)]" style={{ minHeight: altDisponivel }}>
          <Loader2 className="size-4 animate-spin" />
          Abrindo o e-book…
        </div>
      ) : (
        <>
          <div className="relative flex w-full items-center justify-center">
            <BotaoVirar lado="esq" ativo={temAnterior} onClick={anterior} />

            <div
              key={`${inicio}-${dupla}`}
              className={cn("flex", direcao === "frente" ? "virar-frente" : "virar-tras")}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                if (e.clientX - r.left < r.width / 2) anterior();
                else proxima();
              }}
              onTouchStart={(e) => (toque.current = e.touches[0].clientX)}
              onTouchEnd={(e) => {
                if (toque.current === null) return;
                const dx = e.changedTouches[0].clientX - toque.current;
                toque.current = null;
                if (dx > 50) anterior();
                else if (dx < -50) proxima();
              }}
              style={{ cursor: "pointer" }}
              aria-label={`${titulo}: ${rotuloPaginas}`}
            >
              {visiveis.map((n, i) => (
                <Pagina
                  key={n}
                  pdf={pdf}
                  numero={n}
                  largura={larguraPagina}
                  altura={alturaPagina}
                  lado={visiveis.length === 1 ? "unica" : i === 0 ? "esq" : "dir"}
                />
              ))}
            </div>

            <BotaoVirar lado="dir" ativo={temProxima} onClick={proxima} />
          </div>

          <div className="glass mt-5 flex w-full max-w-xl items-center gap-3 rounded-full px-3 py-2">
            <button onClick={anterior} disabled={!temAnterior} aria-label="Página anterior" className="icon-btn disabled:opacity-30">
              <ChevronLeft className="size-4" />
            </button>
            <input
              type="range"
              min={1}
              max={total}
              value={inicio}
              onChange={(e) => ir(Number(e.target.value))}
              aria-label="Ir para a página"
              className="hidden min-w-0 flex-1 accent-[var(--color-accent)] sm:block"
            />
            <span className="flex-1 text-center text-xs tabular-nums text-[var(--color-muted)] sm:flex-none">{rotuloPaginas}</span>
            <button onClick={proxima} disabled={!temProxima} aria-label="Próxima página" className="icon-btn disabled:opacity-30">
              <ChevronRight className="size-4" />
            </button>
            <span className="h-5 w-px bg-[var(--color-border)]" />
            <button onClick={alternarTelaCheia} aria-label={telaCheia ? "Sair da tela cheia" : "Tela cheia"} title={telaCheia ? "Sair da tela cheia" : "Tela cheia"} className="icon-btn">
              {telaCheia ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </button>
            <a href={`${url}?baixar=1`} aria-label="Baixar" title="Baixar" className="icon-btn">
              <Download className="size-4" />
            </a>
          </div>
        </>
      )}
    </div>
  );
}

function BotaoVirar({ lado, ativo, onClick }: { lado: "esq" | "dir"; ativo: boolean; onClick: () => void }) {
  const Icone = lado === "esq" ? ChevronLeft : ChevronRight;
  return (
    <button
      onClick={onClick}
      disabled={!ativo}
      aria-label={lado === "esq" ? "Página anterior" : "Próxima página"}
      className={cn(
        "glass absolute top-1/2 z-10 hidden size-11 -translate-y-1/2 place-items-center rounded-full transition-opacity hover:text-[var(--color-accent)] disabled:pointer-events-none disabled:opacity-0 sm:grid",
        lado === "esq" ? "left-0" : "right-0",
      )}
    >
      <Icone className="size-5" />
    </button>
  );
}

/**
 * Uma página desenhada num canvas, em alta definição (telas retina). A folha
 * branca aparece na hora; o conteúdo entra assim que o pdf.js termina.
 */
function Pagina({
  pdf,
  numero,
  largura,
  altura,
  lado,
}: {
  pdf: PDFDocumentProxy;
  numero: number;
  largura: number;
  altura: number;
  lado: "esq" | "dir" | "unica";
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [tam, setTam] = useState({ w: largura, h: altura });
  const [pronta, setPronta] = useState(false);

  useEffect(() => {
    let vivo = true;
    let tarefa: RenderTask | null = null;
    setPronta(false);

    void pdf
      .getPage(numero)
      .then((pagina) => {
        const el = canvas.current;
        if (!vivo || !el) return;
        // Cada página no tamanho dela (há PDFs com páginas de formatos diferentes).
        const base = pagina.getViewport({ scale: 1 });
        const escala = Math.min(largura / base.width, altura / base.height);
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        const vp = pagina.getViewport({ scale: escala * dpr });
        el.width = Math.floor(vp.width);
        el.height = Math.floor(vp.height);
        setTam({ w: Math.floor(vp.width / dpr), h: Math.floor(vp.height / dpr) });
        tarefa = pagina.render({ canvas: el, viewport: vp });
        return tarefa.promise.then(() => {
          if (vivo) setPronta(true);
        });
      })
      .catch(() => {
        // Render cancelado (virou a página antes de terminar): normal.
      });

    return () => {
      vivo = false;
      tarefa?.cancel();
    };
  }, [pdf, numero, largura, altura]);

  return (
    <div
      className={cn(
        "relative overflow-hidden bg-white shadow-[0_24px_60px_-20px_rgb(0_0_0/0.75),0_2px_6px_rgb(0_0_0/0.35)]",
        lado === "unica" && "rounded-md",
        lado === "esq" && "rounded-l-md",
        lado === "dir" && "rounded-r-md",
      )}
      style={{ width: tam.w, height: tam.h }}
    >
      <canvas ref={canvas} className={cn("block transition-opacity duration-200", pronta ? "opacity-100" : "opacity-0")} style={{ width: tam.w, height: tam.h }} />
      {/* Sombra da lombada: o vinco do meio de um livro aberto. */}
      {lado !== "unica" && (
        <span
          className="pointer-events-none absolute inset-y-0 w-10"
          style={{
            [lado === "esq" ? "right" : "left"]: 0,
            background: `linear-gradient(${lado === "esq" ? "to left" : "to right"}, rgb(0 0 0 / 0.22), rgb(0 0 0 / 0.06) 40%, transparent)`,
          }}
        />
      )}
      {!pronta && <span className="absolute inset-0 animate-pulse bg-[linear-gradient(110deg,#fff,#f1f5f3,#fff)]" />}
    </div>
  );
}

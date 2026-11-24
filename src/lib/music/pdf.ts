// A small PDF writer for the laid-out score: vector lines, curves and Helvetica text.
import { layoutScore, type Op } from "./layout";
import { instrumentOf, type ScoreData } from "./types";
import { keyName } from "./theory";

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 40;

const n = (v: number) => (Math.round(v * 100) / 100).toString();
const pdfText = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, "?");

/** Converts an SVG path (M, L, Q, C, h, v, Z) to PDF operators, flipping y. */
function pathOps(d: string, Y: (y: number) => number): string {
  const tokens = d.match(/[MLQChvZ]|-?\d*\.?\d+/g) ?? [];
  const out: string[] = [];
  let cx = 0;
  let cy = 0;
  let i = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === "M" || cmd === "L") {
      cx = num(); cy = num();
      out.push(`${n(cx)} ${n(Y(cy))} ${cmd === "M" ? "m" : "l"}`);
    } else if (cmd === "Q") {
      const qx = num(), qy = num(), x = num(), y = num();
      const c1x = cx + (2 / 3) * (qx - cx), c1y = cy + (2 / 3) * (qy - cy);
      const c2x = x + (2 / 3) * (qx - x), c2y = y + (2 / 3) * (qy - y);
      out.push(`${n(c1x)} ${n(Y(c1y))} ${n(c2x)} ${n(Y(c2y))} ${n(x)} ${n(Y(y))} c`);
      cx = x; cy = y;
    } else if (cmd === "C") {
      const a = [num(), num(), num(), num(), num(), num()];
      out.push(`${n(a[0]!)} ${n(Y(a[1]!))} ${n(a[2]!)} ${n(Y(a[3]!))} ${n(a[4]!)} ${n(Y(a[5]!))} c`);
      cx = a[4]!; cy = a[5]!;
    } else if (cmd === "h") {
      cx += num(); out.push(`${n(cx)} ${n(Y(cy))} l`);
    } else if (cmd === "v") {
      cy += num(); out.push(`${n(cx)} ${n(Y(cy))} l`);
    } else if (cmd === "Z") {
      out.push("h");
    }
  }
  return out.join("\n");
}

function ellipse(x: number, y: number, rx: number, ry: number, rot: number): string {
  const k = 0.5523;
  const c = Math.cos(rot), s = Math.sin(rot);
  const p = (dx: number, dy: number) => `${n(x + dx * c - dy * s)} ${n(y + dx * s + dy * c)}`;
  return [
    `${p(rx, 0)} m`,
    `${p(rx, ry * k)} ${p(rx * k, ry)} ${p(0, ry)} c`,
    `${p(-rx * k, ry)} ${p(-rx, ry * k)} ${p(-rx, 0)} c`,
    `${p(-rx, -ry * k)} ${p(-rx * k, -ry)} ${p(0, -ry)} c`,
    `${p(rx * k, -ry)} ${p(rx, -ry * k)} ${p(rx, 0)} c`,
  ].join("\n");
}

function drawOps(ops: Op[], dy: number): string {
  const Y = (y: number) => PAGE_H - (y + dy);
  const out: string[] = [];
  for (const op of ops) {
    switch (op.t) {
      case "line":
        out.push(`${n(op.w * 0.7)} w ${n(MARGIN + op.x1)} ${n(Y(op.y1))} m ${n(MARGIN + op.x2)} ${n(Y(op.y2))} l S`);
        break;
      case "head":
        out.push(`0.9 w ${ellipse(MARGIN + op.x, Y(op.y), op.rx, op.ry, 0.35)} ${op.filled ? "f" : "S"}`);
        break;
      case "dot":
        out.push(`${ellipse(MARGIN + op.x, Y(op.y), op.r, op.r, 0)} f`);
        break;
      case "mask":
        out.push(`1 g ${n(MARGIN + op.x)} ${n(Y(op.y + op.h))} ${n(op.w)} ${n(op.h)} re f 0 g`);
        break;
      case "path": {
        const shifted = op.d.replace(/([MLQC])([^MLQChvZ]*)/g, (_, c: string, args: string) => {
          const nums = args.trim().split(/\s+/).map(Number);
          return c + nums.map((v, i) => (i % 2 === 0 ? v + MARGIN : v)).join(" ") + " ";
        });
        out.push(`${n(op.w * 0.7)} w ${pathOps(shifted, Y)} ${op.fill ? "f" : "S"}`);
        break;
      }
      case "text": {
        const size = op.size * 0.9;
        const width = op.s.length * size * 0.55;
        const x = op.anchor === "middle" ? op.x - width / 2 : op.anchor === "end" ? op.x - width : op.x;
        out.push(`BT /${op.bold ? "F2" : "F1"} ${n(size)} Tf ${n(MARGIN + x)} ${n(Y(op.y))} Td (${pdfText(op.s)}) Tj ET`);
        break;
      }
    }
  }
  return out.join("\n");
}

/** A printable A4 PDF of the notation, with tablature for guitar and bass. */
export function toPdf(score: ScoreData): Uint8Array<ArrayBuffer> {
  const width = PAGE_W - MARGIN * 2;
  const tab = score.instrument === "guitar" || score.instrument === "bass";
  const layout = layoutScore(score, { width, tab, sp: 6 });
  const pages: string[] = [];
  let content: string[] = [];
  const header = [
    `BT /F2 18 Tf ${MARGIN} ${PAGE_H - MARGIN - 10} Td (${pdfText(score.title)}) Tj ET`,
    `BT /F1 10 Tf ${MARGIN} ${PAGE_H - MARGIN - 28} Td (${pdfText(`${instrumentOf(score.instrument).label}  -  ${keyName(score.keyFifths, score.keyMode).replace("♯", "#").replace("♭", "b")}  -  ${score.tempo} bpm`)}) Tj ET`,
  ];
  content.push(...header);
  let y = MARGIN + 44;
  for (const sys of layout.systems) {
    const h = sys.bottom - sys.top;
    if (y + h > PAGE_H - MARGIN && content.length > header.length) {
      pages.push(content.join("\n"));
      content = [];
      y = MARGIN;
    }
    const ops = layout.ops.filter((op) => {
      const oy = "y" in op ? op.y : "y1" in op ? op.y1 : Number(op.d.split(" ")[1]);
      return oy >= sys.top - 1 && oy < sys.bottom;
    });
    content.push(drawOps(ops, y - sys.top));
    y += h;
  }
  pages.push(content.join("\n"));

  const objects: string[] = [];
  const add = (body: string) => objects.push(body) ;
  add("<< /Type /Catalog /Pages 2 0 R >>");
  const firstPage = 5;
  const kids = pages.map((_, i) => `${firstPage + i * 2} 0 R`).join(" ");
  add(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  pages.forEach((stream, i) => {
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${firstPage + i * 2 + 1} 0 R >>`);
    add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

/**
 * What a file tab draws.
 *
 * Text is the file. A picture is the picture. A PDF is the PDF. Anything else, and anything too
 * large to move into the window, is still a tab: the sentence says why there is nothing to read.
 */

import type { JSX } from "react";
import { useEffect, useState } from "react";

import { useT } from "../i18n/context.js";
import { localize, type Notice } from "../i18n/notice.js";

export interface OpenedFile {
  path: string;
  name: string;
  kind: "text" | "image" | "pdf" | "binary" | "tooLarge";
  size: number;
  mimeType?: string;
  content?: string;
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileView(props: {
  file: OpenedFile | undefined;
  loading: boolean;
  notice: Notice | undefined;
}): JSX.Element {
  const t = useT();
  if (props.loading) return <p className="file-view__status">{t("explorer.file.loading")}</p>;
  if (props.notice || props.file === undefined) {
    return (
      <p className="file-view__status" role="status">
        {props.notice ? (localize(t, props.notice) ?? t("explorer.file.failed")) : t("explorer.file.failed")}
      </p>
    );
  }
  const file = props.file;
  if (file.kind === "text") {
    return <pre className="file-view__text">{file.content ?? ""}</pre>;
  }
  if (file.kind === "image" && file.content) {
    const mime = file.mimeType ?? "image/png";
    return (
      <div className="file-view__frame">
        <img src={`data:${mime};base64,${file.content}`} alt={file.name} />
      </div>
    );
  }
  if (file.kind === "pdf" && file.content) return <PdfFrame name={file.name} content={file.content} />;
  if (file.kind === "tooLarge") {
    return (
      <p className="file-view__status" role="status">
        {t("explorer.file.tooLarge", { size: formatBytes(file.size) })}
      </p>
    );
  }
  return (
    <p className="file-view__status" role="status">
      {t("explorer.file.binary")}
      <span className="file-view__meta">{formatBytes(file.size)}</span>
    </p>
  );
}

function PdfFrame(props: { name: string; content: string }): JSX.Element {
  const [url, setUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    const binary = atob(props.content);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const next = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [props.content]);
  if (!url) return <p className="file-view__status"> </p>;
  return <iframe className="file-view__pdf" src={url} title={props.name} />;
}

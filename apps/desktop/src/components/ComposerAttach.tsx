/**
 * The attach control on the composer: a button, a short menu, and the pills above the field.
 *
 * The menu is the same three actions the reference product's message field offers for files — add an
 * image, paste an image, add a file. Issue and plugin attachments are not here; this product has
 * neither. The pills are the files already chosen, each with a way to take it back.
 */

import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";

import type { ComposerAttachment } from "../composer/attachments.js";
import { useT } from "../i18n/context.js";
import { FileIcon, PaperclipIcon } from "./icons.js";

export function AttachmentTray(props: {
  attachments: readonly ComposerAttachment[];
  onRemove: (id: string) => void;
}): JSX.Element | null {
  const t = useT();
  if (props.attachments.length === 0) return null;
  return (
    <ul className="composer__tray">
      {props.attachments.map((attachment) => (
        <li key={attachment.id} className="composer__pill">
          {attachment.kind === "image" && attachment.data ? (
            <img alt="" src={`data:${attachment.mimeType};base64,${attachment.data}`} />
          ) : (
            <FileIcon size={14} />
          )}
          <span className="composer__pill-name" title={attachment.name}>
            {attachment.name}
          </span>
          <button
            type="button"
            className="composer__pill-remove"
            aria-label={t("task.composer.attach.remove", { name: attachment.name })}
            onClick={() => props.onRemove(attachment.id)}
          >
            <span aria-hidden>×</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function AttachButton(props: {
  disabled: boolean;
  onAdd: (files: File[]) => void;
  onPasteFailed: () => void;
}): JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPress = (event: Event): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      // Before the shell's Escape, which stops the agent. Closing this menu is the keystroke.
      event.stopPropagation();
      event.preventDefault();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPress, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPress, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (input: HTMLInputElement | null): void => {
    setOpen(false);
    input?.click();
  };

  const take = (list: FileList | null): void => {
    if (!list || list.length === 0) return;
    props.onAdd([...list]);
  };

  const pasteImage = (): void => {
    setOpen(false);
    const read = navigator.clipboard?.read;
    if (!read) {
      props.onPasteFailed();
      return;
    }
    void read
      .call(navigator.clipboard)
      .then(async (items) => {
        const files: File[] = [];
        for (const item of items) {
          const type = item.types.find((entry) => entry.startsWith("image/"));
          if (!type) continue;
          const blob = await item.getType(type);
          const ext = type === "image/jpeg" ? "jpg" : (type.split("/")[1] ?? "png");
          files.push(new File([blob], `image.${ext}`, { type }));
        }
        if (files.length === 0) props.onPasteFailed();
        else props.onAdd(files);
      })
      .catch(() => props.onPasteFailed());
  };

  return (
    <div className="composer__attach" ref={rootRef}>
      <button
        type="button"
        className="button button--ghost button--icon composer__attach-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("task.composer.attach")}
        title={t("task.composer.attach")}
        disabled={props.disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <PaperclipIcon size={16} />
      </button>
      {open ? (
        <div className="row-menu__list composer__attach-menu" role="menu" aria-label={t("task.composer.attach")}>
          <button type="button" role="menuitem" className="row-menu__item" onClick={() => pick(imageRef.current)}>
            {t("task.composer.attach.image")}
          </button>
          <button type="button" role="menuitem" className="row-menu__item" onClick={pasteImage}>
            {t("task.composer.attach.paste")}
          </button>
          <button type="button" role="menuitem" className="row-menu__item" onClick={() => pick(fileRef.current)}>
            {t("task.composer.attach.file")}
          </button>
        </div>
      ) : null}
      <input
        ref={imageRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
        multiple
        hidden
        data-attach="image"
        onChange={(event) => {
          take(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        data-attach="file"
        onChange={(event) => {
          take(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
    </div>
  );
}

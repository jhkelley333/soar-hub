// Chat — centered system-event pill (created, renamed, pinned, etc.).

export function SystemMessage({ text, at }: { text: string; at: string }) {
  return (
    <div className="my-2 flex justify-center">
      <span className="rounded-full bg-surface-sunk px-3 py-1 text-[11.5px] text-midnight-500">
        {text} · {at}
      </span>
    </div>
  );
}

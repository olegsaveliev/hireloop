"use client";

import { useState } from "react";

// A message in a conversation on the Job page: long bodies show their first lines and a "Show full" link.
export function MessageBody({ body }: { body: string }) {
  const long = body.length > 360 || body.split("\n").length > 7;
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className={`whitespace-pre-wrap text-stone-700 ${long && !open ? "line-clamp-5" : ""}`}>{body}</div>
      {long && (
        <button type="button" onClick={() => setOpen(!open)} className="mt-1 text-sm text-olive hover:underline">
          {open ? "Show less" : "Show full"}
        </button>
      )}
    </>
  );
}

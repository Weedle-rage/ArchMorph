"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { deleteCloudProject, syncProjects } from "@/lib/cloud-sync";
import { PROJECT_DELETED_EVENT, PROJECT_SAVED_EVENT } from "@/lib/persistence";
import { getSupabase } from "@/lib/supabase";
import styles from "./AccountButton.module.css";

type Status = "idle" | "syncing" | "synced" | "error";

export default function AccountButton({ onProjectsPulled }: { onProjectsPulled?: () => void }) {
  const supabase = getSupabase();
  const [session, setSession] = useState<Session | null>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const timer = useRef<number | undefined>(undefined);
  const userId = session?.user.id;

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  const sync = useCallback(async () => {
    if (!supabase || !userId) return;
    setStatus("syncing");
    try {
      const result = await syncProjects(supabase, userId);
      setStatus("synced");
      if (result.pulled > 0) onProjectsPulled?.();
    } catch {
      setStatus("error");
    }
  }, [supabase, userId, onProjectsPulled]);

  useEffect(() => {
    if (!supabase || !userId) return;
    const queue = (delay = 3000) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void sync(), delay);
    };
    queue(0);
    const onDeleted = (event: Event) => {
      const id = (event as CustomEvent<{ projectId: string }>).detail.projectId;
      void deleteCloudProject(supabase, id).catch(() => setStatus("error"));
    };
    const onSaved = () => queue();
    window.addEventListener(PROJECT_SAVED_EVENT, onSaved);
    window.addEventListener(PROJECT_DELETED_EVENT, onDeleted);
    return () => {
      window.clearTimeout(timer.current);
      window.removeEventListener(PROJECT_SAVED_EVENT, onSaved);
      window.removeEventListener(PROJECT_DELETED_EVENT, onDeleted);
    };
  }, [supabase, userId, sync]);

  if (!supabase) return null;

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase || !email.trim()) return;
    setMessage("Sending…");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/studio` },
    });
    if (error) {
      setMessage(error.message);
      return;
    }
    setCodeSent(true);
    setMessage("Check your email. Click the newest link, or type the 6-digit code below.");
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase || !code.trim()) return;
    setMessage("Checking…");
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    if (error) setMessage(error.message);
    else {
      setCode("");
      setCodeSent(false);
      setMessage("");
      setOpen(false);
    }
  }

  const label = session
    ? `${session.user.email ?? "Account"} · ${{ idle: "", syncing: "saving…", synced: "saved to cloud", error: "sync failed" }[status]}`
    : "Sign in to save online";

  return (
    <div className={styles.wrap}>
      {open && (
        <div className={styles.popover}>
          {session ? (
            <>
              <p>{session.user.email}</p>
              <button type="button" onClick={() => void sync()}>Sync now</button>
              <button
                type="button"
                onClick={() => {
                  void supabase.auth.signOut();
                  setOpen(false);
                  setStatus("idle");
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <form onSubmit={signIn}>
              <label>
                Email
                <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
              </label>
              <button type="submit">{codeSent ? "Send a new link or code" : "Email me a sign-in link"}</button>
              {message && <small>{message}</small>}
              <small>Your projects stay on this device until you sign in.</small>
            </form>
          )}
          {!session && codeSent && (
            <form onSubmit={verifyCode}>
              <label>
                6-digit code
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={10}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </label>
              <button type="submit">Sign in with code</button>
            </form>
          )}
        </div>
      )}
      <button type="button" className={styles.pill} onClick={() => setOpen((value) => !value)}>
        {label}
      </button>
    </div>
  );
}

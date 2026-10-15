import { useSyncExternalStore } from "react";
import { dismissToast, feedbackSnapshot, subscribeFeedback } from "@/lib/feedback";

export function WorkScreen({ label }: { label: string }) {
  return (
    <div className="work-screen" role="status" aria-live="polite" aria-busy="true">
      <div className="work-card">
        <div className="work-bar" />
        <div className="eyebrow">Please wait</div>
        <p className="mt-2 text-lg font-medium">{label}</p>
      </div>
    </div>
  );
}

export function FeedbackLayer() {
  const { label, toasts } = useSyncExternalStore(subscribeFeedback, feedbackSnapshot, feedbackSnapshot);
  return (
    <>
      {label ? <WorkScreen label={label} /> : null}
      <div className="toast-stack">
        {toasts.map((item) => (
          <div key={item.id} className={`toast toast-${item.tone}`} role="status">
            <p>{item.text}</p>
            <button type="button" onClick={() => dismissToast(item.id)}>Close</button>
          </div>
        ))}
      </div>
    </>
  );
}

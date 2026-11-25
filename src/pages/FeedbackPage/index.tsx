import { useState } from "react";
import { MessageSquarePlus, ListChecks } from "lucide-react";
import FeedbackForm from "./FeedbackForm";
import MyFeedbackList from "./MyFeedbackList";
import FeedbackAccount from "./FeedbackAccount";

type Tab = "submit" | "mine";

/** 意见反馈：提交反馈 / 我的反馈（SCC 统一反馈，见 dev_docs/refs/software_control_center.md） */
export default function FeedbackPage() {
  const [tab, setTab] = useState<Tab>("submit");
  // 提交成功后让「我的反馈」重新拉取
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <div className="page-container fb-page">
      <div className="fb-header">
        <div className="fb-tabs" role="tablist">
          {(
            [
              ["submit", "提交反馈", MessageSquarePlus],
              ["mine", "我的反馈", ListChecks],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={`fb-tab ${tab === key ? "active" : ""}`}
              onClick={() => setTab(key)}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
        <FeedbackAccount />
      </div>

      <div className="card fb-card">
        {tab === "submit" ? (
          <FeedbackForm onSubmitted={() => setReloadKey((k) => k + 1)} />
        ) : (
          <MyFeedbackList reloadKey={reloadKey} />
        )}
      </div>
    </div>
  );
}

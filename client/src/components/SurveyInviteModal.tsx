// 退出登录时的问卷邀请弹窗（问卷星外链）
export default function SurveyInviteModal({
  onAgree,
  onDecline,
  onCancel,
}: {
  onAgree: () => void
  onDecline: () => void
  onCancel: () => void
}) {
  return (
    <div className="survey-overlay">
      <div className="survey-pop">
        <button className="survey-x" onClick={onCancel} aria-label="取消">
          ✕
        </button>
        <div className="survey-emoji">💙🩷</div>
        <h2>在离开之前…</h2>
        <p>
          愿意花 1 分钟给我们一个反馈吗？
          <br />
          你的意见会让网站变得更好 ✨
        </p>
        <div className="survey-actions">
          <button className="survey-agree" onClick={onAgree}>
            愿意反馈
          </button>
          <button className="survey-decline" onClick={onDecline}>
            直接退出
          </button>
        </div>
      </div>
    </div>
  )
}

(function initSecondMobileView(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  const target = root?.window || root;
  if (target) target.SecondMobileView = api;
  if (typeof window === "object") window.SecondMobileView = api;
  if (typeof globalThis === "object") globalThis.SecondMobileView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSecondMobileView() {
  "use strict";

  function createMobileView(deps = {}) {
    const {
      PRODUCT_NAME = "Second",
      brandMark = () => "",
      escapeAttr = escapeHtmlAttribute,
      escapeHtml = escapeHtmlText,
    } = deps;

    function render(state = {}) {
      const decision = (state.decisions || []).find((item) => item.status === "pending") || (state.decisions || [])[0];
      const pending = decision?.status === "pending";
      const profile = state.profile || {};
      const metrics = state.metrics || {};
      return `
        <div class="page">
          <div class="content-med">
            <h1 style="margin:0;font-size:18px;font-weight:700">轻决策 · 决策去人所在处</h1>
            <div class="page-subtitle" style="max-width:620px">日常轻决策不回桌面:带按钮的消息直接出现在 Slack,人不在电脑前时由手机推送兜底。在这里点批准,收件箱与任务同步更新。</div>
            <div class="mobile-wrap">
              <div class="phone">
                <div class="phone-screen">
                  <div class="lock-date">7月7日 周二</div>
                  <div class="lock-time">10:36</div>
                  <div class="notification">
                    <div class="notif-head">
                      ${brandMark("mini-mark")}
                      <span class="notif-app">${PRODUCT_NAME} · 决策请求</span>
                      <span style="flex:1"></span>
                      <span style="font-size:11px;opacity:.5">现在</span>
                    </div>
                    <div class="notif-title">${decision ? `${escapeHtml(decision.title)} · ${escapeHtml(decision.risk)}风险` : "暂无待决策"}</div>
                    <div class="notif-sub">${decision ? `${escapeHtml(decision.taskId)} · ${escapeHtml(decision.agent)}` : "所有任务继续后台执行"}</div>
                    ${pending ? `
                      <div class="notif-actions">
                        <button class="notif-button" data-action="resolve-decision" data-id="${escapeAttr(decision.id)}" data-verdict="approved">批准</button>
                        <button class="notif-button secondary" data-action="resolve-decision" data-id="${escapeAttr(decision.id)}" data-verdict="rejected">拒绝</button>
                      </div>
                    ` : `<div style="margin-top:12px;text-align:center;font-size:12.5px;font-weight:700;color:#7EE2A8;background:rgba(126,226,168,.12);border-radius:10px;padding:9px 0">✓ 全部处理完毕</div>`}
                  </div>
                  <div class="notification">
                    <div class="notif-app">${PRODUCT_NAME} · 任务进度</div>
                    <div style="font-size:12.5px;margin-top:6px;opacity:.75;line-height:1.5">${escapeHtml(profile.agentName)}今天完成 ${metrics.completedTasks || 0} 个任务,拦截 ${metrics.highRiskBlocks || 0} 次越权操作,零中转率 ${metrics.zeroHandoffRate || 0}%。</div>
                  </div>
                </div>
              </div>
              ${slackPreview(decision)}
            </div>
          </div>
        </div>
      `;
    }

    function slackPreview(decision) {
      const pending = decision?.status === "pending";
      return `
        <div class="slack-card">
          <div class="slack-shell">
            <div class="slack-head">
              <span style="font-size:13px;font-weight:750"># payments</span>
              <span style="font-size:11px;color:var(--faint)">Slack · 审批按钮消息</span>
            </div>
            <div class="slack-body">
              <div class="slack-msg">
                <div class="slack-avatar">张</div>
                <div>
                  <div style="font-size:13px"><b>张薇</b> <span style="font-size:11px;color:var(--faint)">10:02</span></div>
                  <div style="font-size:13.5px;margin-top:3px;line-height:1.55">线上订单偶发重复扣款,<span class="mention">@李哲</span> 今天能修吗?</div>
                </div>
              </div>
              <div class="slack-msg">
                ${brandMark("slack-app-mark")}
                <div style="flex:1">
                  <div style="font-size:13px"><b>${PRODUCT_NAME}</b> <span class="tag" style="font-size:10px;padding:1px 4px">APP</span> <span style="font-size:11px;color:var(--faint)">10:31</span></div>
                  <div style="font-size:13px;margin-top:3px;line-height:1.6;color:#3A362E">李哲的分身已接住任务并完成修复。回填受影响订单需要<b>生产库写权限</b>,超出当前授权。</div>
                  <div class="slack-evidence mono" style="font-size:11px;color:#6E6858">${decision ? `${escapeHtml(decision.id)} · ${escapeHtml(decision.risk)}风险 · ${escapeHtml(decision.title)}` : "暂无待决策"}</div>
                  ${pending ? `
                    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
                      <button class="btn" style="background:#007A5A;color:#fff;border:0;border-radius:6px;font-size:12.5px" data-action="resolve-decision" data-id="${escapeAttr(decision.id)}" data-verdict="approved">批准</button>
                      <button class="btn" style="border-radius:6px;font-size:12.5px" data-action="resolve-decision" data-id="${escapeAttr(decision.id)}" data-verdict="rejected">拒绝</button>
                      <button class="btn" style="border-radius:6px;font-size:12.5px" data-action="open-decision" data-id="${escapeAttr(decision.id)}">查看证据包</button>
                    </div>
                  ` : `<div style="margin-top:10px;font-size:12.5px;font-weight:650;color:#007A5A">✓ 已处理 · 任务已恢复,结果稍后回传本线程</div>`}
                </div>
              </div>
            </div>
          </div>
          <div style="font-size:11.5px;color:var(--faint);margin-top:12px;line-height:1.7">同一个决策,三处可答:Slack 按钮、手机推送、Web 证据包。任一处决策后,其余入口同步关闭,任务在 runtime 可恢复地继续。</div>
        </div>
      `;
    }

    return {
      render,
      slackPreview,
    };
  }

  function escapeHtmlText(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => (
      {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[char]
    ));
  }

  function escapeHtmlAttribute(value) {
    return escapeHtmlText(value);
  }

  return {
    createMobileView,
  };
});

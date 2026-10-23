const fixture = (id, name, input, checks, a, b) => ({
  id,
  name,
  input,
  checks,
  demo: { a, b },
});
export function getPreset(language = "en", topic = "support") {
  const zh = language === "zh";
  if (topic === "extract")
    return {
      version: 1,
      name: zh ? "结构化信息提取" : "Structured extraction",
      prompts: {
        a: zh ? "提取信息：\n{{input}}" : "Extract the information:\n{{input}}",
        b: zh
          ? "只输出有效 JSON，不要 Markdown。返回 name（姓名）、email（邮箱）、priority（low 或 high）。包含紧急或 urgent 时 priority 为 high，否则为 low。缺失值用 null。\n文本：{{input}}"
          : "Return valid JSON only, no markdown. Fields: name, email, priority (low or high). Set priority to high when the text says urgent; otherwise low. Use null for missing values.\nText: {{input}}",
      },
      cases: [
        fixture(
          "extract-1",
          zh ? "基本联系人" : "Basic contact",
          "Name: Alex, email: alex@example.com",
          [
            { type: "json" },
            { type: "json_path", path: "email", value: "alex@example.com" },
          ],
          "Alex can be reached at alex@example.com.",
          '{"name":"Alex","email":"alex@example.com","priority":"low"}',
        ),
        fixture(
          "extract-2",
          zh ? "紧急请求" : "Urgent request",
          "URGENT: Sam, sam@example.com needs help.",
          [
            { type: "json" },
            { type: "json_path", path: "priority", value: "high" },
          ],
          '{"name":"Sam","email":"sam@example.com","priority":"low"}',
          '{"name":"Sam","email":"sam@example.com","priority":"high"}',
        ),
        fixture(
          "extract-3",
          zh ? "缺失字段" : "Missing field",
          "Name: Jo. No email provided.",
          [{ type: "json" }, { type: "json_path", path: "email", value: null }],
          '{"name":"Jo","email":null,"priority":"low"}',
          '{"name":"Jo","email":null,"priority":"low"}',
        ),
      ],
    };
  if (zh)
    return {
      version: 1,
      name: "客服回复 · 提示词回归测试",
      prompts: {
        a: "你是一个友善的客服助手。回答用户的问题。\n\n用户：{{input}}",
        b: "你是一个严谨的客服助手。\n规则：\n1. 退款需要订单号；缺失时先索取订单号。\n2. 无法验证到账时间，不承诺退款一定成功或立即到账。\n3. 不索取密码。遇到密码相关内容，提醒不要提供密码。\n4. 回复不超过 120 字。\n\n用户：{{input}}",
      },
      cases: [
        fixture(
          "missing-order",
          "缺少订单号",
          "我想退款，但是找不到订单了。",
          [{ type: "contains", value: "订单号" }],
          "好的，我会为你申请退款，请稍等。",
          "请先提供订单号，你可以在订单列表或确认邮件中查找。我会根据订单信息协助你核查。",
        ),
        fixture(
          "no-guarantees",
          "避免不实承诺",
          "退款能马上到账吗？",
          [{ type: "not_contains", value: "保证立即到账" }],
          "放心，我们保证立即到账。",
          "到账时间取决于支付渠道和审核进度。请提供订单号，我会协助查询当前状态。",
        ),
        fixture(
          "password",
          "保护敏感信息",
          "需要把我的账号密码发给你吗？",
          [{ type: "contains", value: "不要提供密码" }],
          "不要提供密码，我们只需要必要的订单信息。",
          "不要提供密码。核查退款只需要订单号，请勿分享账号凭证。",
        ),
        fixture(
          "short-answer",
          "控制回复长度",
          "订单取消后怎么查看进度？",
          [{ type: "max_length", value: 120 }],
          "你可以进入订单详情页查看取消或退款进度，如有疑问请提供订单号。",
          "请在订单详情页查看状态。如需进一步核查，请提供订单号。",
        ),
        fixture(
          "order-provided",
          "已有订单号",
          "我的订单号是 AB123，想知道退款进度。",
          [
            { type: "contains", value: "AB123" },
            { type: "not_contains", value: "已到账" },
          ],
          "收到订单 AB123，我会协助查询退款进度。",
          "收到订单号 AB123。当前对话无法直接核实退款状态，请在订单详情页查看或联系人工客服核查。",
        ),
      ],
    };
  return {
    version: 1,
    name: "Support replies · prompt regression suite",
    prompts: {
      a: "You are a friendly customer support assistant. Answer the customer.\n\nCustomer: {{input}}",
      b: "You are a careful customer support assistant.\nRules:\n1. Refund requests require an order ID. Ask for it when missing.\n2. Never guarantee instant refunds or invent payment status.\n3. Never request passwords. Tell the customer not to share passwords when relevant.\n4. Keep replies under 300 characters.\n\nCustomer: {{input}}",
    },
    cases: [
      fixture(
        "missing-order",
        "Missing order ID",
        "I want a refund, but I cannot find my order.",
        [{ type: "contains", value: "order ID" }],
        "Absolutely! I will process your refund right away.",
        "Please share your order ID so we can check the refund request. You can find it in your confirmation email.",
      ),
      fixture(
        "no-guarantees",
        "No false promises",
        "Will my refund arrive right now?",
        [{ type: "not_contains", value: "guaranteed instant refund" }],
        "Yes, you will get a guaranteed instant refund!",
        "Refund timing depends on the payment provider and review status. Please share your order ID so we can check.",
      ),
      fixture(
        "password",
        "Sensitive information",
        "Do you need my account password?",
        [{ type: "contains", value: "do not share passwords" }],
        "Please do not share passwords. Only your order information is needed.",
        "Please do not share passwords. An order ID is enough to start checking your request.",
      ),
      fixture(
        "short-answer",
        "Concise response",
        "How do I check a canceled order?",
        [{ type: "max_length", value: 300 }],
        "Open the order details page to see the cancellation status. Share your order ID if you need help.",
        "Open the order details page to check its status. Share your order ID if you would like further help.",
      ),
      fixture(
        "order-provided",
        "Known order ID",
        "My order ID is AB123. Can you check my refund?",
        [
          { type: "contains", value: "AB123" },
          { type: "not_contains", value: "already refunded" },
        ],
        "Thanks for sharing AB123. I can help you check the refund status.",
        "Thanks for sharing AB123. I cannot verify payment status here. Please check the order page or contact the support team.",
      ),
    ],
  };
}

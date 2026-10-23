# Contributing / 贡献指南

Small, understandable changes are welcome. Keep the no-build, zero-runtime-dependency workflow intact unless there is a concrete reason to change it.

欢迎小而清晰的改进。除非有明确需求，请保留无需构建、零运行时依赖的工作流。

1. Fork and create a branch. / Fork 后新建分支。
2. Run `npm start`; check both languages and a narrow viewport. / 启动服务，检查中英文和窄屏布局。
3. Run `npm run check` and `npm test`. / 运行语法检查和测试。
4. Describe the user-visible behavior and how you verified it. / 说明用户能看到的变化及验证方法。

## Where changes belong / 文件位置

- Evaluation behavior / 评测逻辑: `public/core.js`
- Browser behavior / 界面交互: `public/app.js`
- Translations / 界面翻译: `public/i18n.js`
- Presets / 示例场景: `public/presets.js` and `examples/*.json`
- Provider adapter / 模型接口适配: `src/provider.js`
- Server / 本地服务: `src/server.js`
- CLI / 命令行: `src/cli.js`

For new checks, add meaningful boundary tests and both translations. Presets and `examples/` should describe the same suites. Never add keys, `.env`, private reports, or invented performance numbers. Clearly distinguish fixture playback from live execution.

新增规则时，请补充有意义的边界测试及中英翻译。预设与 `examples/` 应保持一致。不要提交密钥、`.env`、私人报告或虚构的性能数据。请明确区分预录回放与真实调用。

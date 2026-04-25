# AvatarReelsHelper — Project Rules

## Git 操作须经用户确认

**在执行任何 `git commit` 或 `git push` 之前，必须先询问用户是否确认。**

流程：
1. 代码改好之后，先 `git add`
2. **暂停**，向用户说明本次改动内容，然后问："是否确认 commit？"
3. 用户确认后，执行 `git commit`
4. **再次暂停**，问："是否确认 push 部署到 Cloud Run？"（push 到 main 会自动触发 Cloud Build 部署生产环境）
5. 用户确认后，才执行 `git push origin main`

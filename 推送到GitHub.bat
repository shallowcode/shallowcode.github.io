@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ==================================================
echo    把博客改动推送到 GitHub
echo ==================================================
echo.

rem 清理可能残留的 git 锁文件（无其它 git 在运行时是安全的）
if exist ".git\index.lock" del /f /q ".git\index.lock" >nul 2>&1
if exist ".git\HEAD.lock" del /f /q ".git\HEAD.lock" >nul 2>&1
if exist ".git\refs\heads\main.lock" del /f /q ".git\refs\heads\main.lock" >nul 2>&1

git add -A

git diff --cached --quiet
if errorlevel 1 (
    git commit -m "重新设计博客为温暖手账风，并给发布助手加入删除功能"
) else (
    echo 没有新的改动需要提交，直接尝试推送...
)

echo.
echo 正在推送到 GitHub...
git push
echo.

if errorlevel 1 (
    echo [x] 推送好像没成功，请把上面的提示文字发给我看看。
) else (
    echo [√] 完成！等一两分钟刷新你的博客页面就能看到新设计。
)

echo.
pause

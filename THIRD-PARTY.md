# 第三方来源与许可

本仓库包含来自下列开源项目的数据或代码，按各自许可使用并署名。

## serverless-colleage

| 项 | 内容 |
|---|---|
| 用途 | `packages/core/src/import/schools.ts` 中的高校名单（仅校名，自动生成段） |
| 来源 | https://github.com/vczero/serverless-colleage |
| 生成方式 | `python tools/import-schools.py <适配仓库根目录> <该仓库的 大学目录.json>` |
| 许可说明 | 名单内容为教育部公开的全国普通高等学校名单，属公开事实性数据；上游仓库未附开源许可声明，因此本项目**只取校名用于检索**，不复制其代码或其他内容。若需进一步使用其内容，请先与上游确认授权 |

## shiguang_warehouse

| 项 | 内容 |
|---|---|
| 用途 | `packages/core/src/import/schools.ts` 中的高校与教务入口数据（自动生成段） |
| 来源 | https://github.com/ShiGuangSchedule/shiguang_warehouse |
| 保留内容 | 适配条目名称、入口地址、学校代码、维护者署名 |
| 生成方式 | `python tools/import-schools.py <仓库根目录>` |

```
MIT License

Copyright (c) 2025 星河欲转

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

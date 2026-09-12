# Contributor avatars

Public profile avatars downloaded on 2026-09-12 from GitHub and resized to at most 320 px
WebP for local rendering. They identify the linked contributors; they are not
generated portraits or site-owned brand assets.

| Local file | Original public avatar | Profile |
| --- | --- | --- |
| `weihong-liu.webp` | https://avatars.githubusercontent.com/u/65588374?v=4 | https://github.com/Weihong-Liu |
| `amdjiahangpan.webp` | https://avatars.githubusercontent.com/u/234142584?v=4 | https://github.com/amdjiahangpan |
| `lucachen.webp` | https://avatars.githubusercontent.com/u/17821219?v=4 | https://github.com/LucaChen |
| `youyoulyz.webp` | https://avatars.githubusercontent.com/u/29258210?v=4 | https://github.com/youyoulyz |

The list and ordering came from all pages of
`GET https://api.github.com/repos/datawhalechina/hello-gpu/contributors?per_page=100`.
Four `User` accounts were returned and no bots were present. The endpoint reflects
the repository's default branch and may lag recently merged commits. The page links
to GitHub's current contributor view instead of presenting this snapshot as live.

Display names were verified against the public `GET /users/{login}` profiles.
刘伟鸿's name, project lead role and Datawhale membership follow the repository's
`README.md`; other cards use the neutral label “贡献者” without invented roles,
biographies or contribution statistics. Update `theme/contributors.ts` and these
assets together when refreshing the snapshot.

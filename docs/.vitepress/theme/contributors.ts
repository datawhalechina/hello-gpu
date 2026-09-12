/**
 * Public contributor snapshot, verified 2026-09-12.
 * Source: https://api.github.com/repos/datawhalechina/hello-gpu/contributors?per_page=100
 * Names: the linked public GitHub profiles, except 刘伟鸿 and his attribution,
 * which follow this repository's README.md (贡献者名单).
 * Includes every User returned by the endpoint; bot accounts are excluded.
 * GitHub's contributor endpoint reflects commits in the default branch and can
 * lag recent merges. This is a build-time snapshot, not a live contribution feed.
 */
export interface Contributor {
  login: string
  name: string
  role: string
  affiliation?: string
  url: string
  avatar: string
}

export const contributors: Contributor[] = [
  {
    login: 'Weihong-Liu',
    name: '刘伟鸿',
    role: '项目负责人',
    affiliation: 'Datawhale 成员',
    url: 'https://github.com/Weihong-Liu',
    avatar: '/images/contributors/weihong-liu.webp',
  },
  {
    login: 'amdjiahangpan',
    name: 'paniford',
    role: '贡献者',
    url: 'https://github.com/amdjiahangpan',
    avatar: '/images/contributors/amdjiahangpan.webp',
  },
  {
    login: 'LucaChen',
    name: '陈榆',
    role: '贡献者',
    url: 'https://github.com/LucaChen',
    avatar: '/images/contributors/lucachen.webp',
  },
  {
    login: 'youyoulyz',
    name: 'youyoulyz',
    role: '贡献者',
    url: 'https://github.com/youyoulyz',
    avatar: '/images/contributors/youyoulyz.webp',
  },
]

export const contributorsUrl = 'https://github.com/datawhalechina/hello-gpu/graphs/contributors'
export const contributeUrl = 'https://github.com/datawhalechina/hello-gpu/blob/dev/CONTRIBUTING.md'

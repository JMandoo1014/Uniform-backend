// Spec 6.4: 순위 목록은 한 페이지에 10명씩, 50위(5페이지)까지만 보여준다.
export const LEADERBOARD_PAGE_SIZE = 10;
export const LEADERBOARD_MAX_PAGES = 5;
export const LEADERBOARD_MAX_ENTRIES =
  LEADERBOARD_PAGE_SIZE * LEADERBOARD_MAX_PAGES;

export const DEFAULT_LEADERBOARD_CONFIG_ID = 'default';

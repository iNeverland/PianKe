/// <reference path="../pb_data/types.d.ts" />

// 按 owner 的权限规则会先缩小数据范围；这些复合索引再让详情页、日记页和
// 照片墙的按影片查询直接命中索引，避免库增长后退化为全表扫描。
migrate((app) => {
  const addIndexes = (name, indexes) => {
    const collection = app.findCollectionByNameOrId(name);
    const existing = collection.indexes || [];
    collection.indexes = [...existing, ...indexes.filter((index) => !existing.includes(index))];
    app.save(collection);
  };

  addIndexes('movies', [
    'CREATE INDEX idx_movies_owner_status ON movies (owner, status)',
    'CREATE INDEX idx_movies_owner_created ON movies (owner, created)',
  ]);
  addIndexes('diary_entries', [
    'CREATE INDEX idx_diary_owner_movie_date ON diary_entries (owner, movie, watchDate)',
    'CREATE INDEX idx_diary_owner_date ON diary_entries (owner, watchDate)',
  ]);
  addIndexes('watch_records', [
    'CREATE INDEX idx_watch_records_owner_movie_date ON watch_records (owner, movie, watchDate)',
  ]);
  addIndexes('screenshots', [
    'CREATE INDEX idx_screenshots_owner_movie ON screenshots (owner, movie)',
  ]);
}, (app) => {
  const removeIndexes = (name, indexes) => {
    const collection = app.findCollectionByNameOrId(name);
    collection.indexes = (collection.indexes || []).filter((index) => !indexes.includes(index));
    app.save(collection);
  };

  removeIndexes('movies', [
    'CREATE INDEX idx_movies_owner_status ON movies (owner, status)',
    'CREATE INDEX idx_movies_owner_created ON movies (owner, created)',
  ]);
  removeIndexes('diary_entries', [
    'CREATE INDEX idx_diary_owner_movie_date ON diary_entries (owner, movie, watchDate)',
    'CREATE INDEX idx_diary_owner_date ON diary_entries (owner, watchDate)',
  ]);
  removeIndexes('watch_records', [
    'CREATE INDEX idx_watch_records_owner_movie_date ON watch_records (owner, movie, watchDate)',
  ]);
  removeIndexes('screenshots', [
    'CREATE INDEX idx_screenshots_owner_movie ON screenshots (owner, movie)',
  ]);
});

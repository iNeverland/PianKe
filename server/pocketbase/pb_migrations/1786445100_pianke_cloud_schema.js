/// <reference path="../pb_data/types.d.ts" />

const OWNER_RULE = "owner = @request.auth.id";
const OWNER_CREATE_RULE = "@request.auth.id != '' && owner = @request.auth.id";

function ownerField(users) {
  return {
    name: "owner",
    type: "relation",
    required: true,
    collectionId: users.id,
    maxSelect: 1,
    cascadeDelete: true,
  };
}

function privateRules(collection) {
  collection.listRule = OWNER_RULE;
  collection.viewRule = OWNER_RULE;
  collection.createRule = OWNER_CREATE_RULE;
  collection.updateRule = OWNER_RULE;
  collection.deleteRule = OWNER_RULE;
  return collection;
}

migrate((app) => {
  // PocketBase 首次初始化已创建 users 认证集合；复用它，并与管理员
  // （_superusers）保持分离。应用用户只能读取/修改自身资料。
  const users = app.findCollectionByNameOrId("users");
  users.listRule = "id = @request.auth.id";
  users.viewRule = "id = @request.auth.id";
  users.createRule = "";
  users.updateRule = "id = @request.auth.id";
  users.deleteRule = "id = @request.auth.id";
  users.authRule = "";
  users.manageRule = "id = @request.auth.id";
  users.fields.add(new TextField({ name: "displayName", max: 100 }));
  app.save(users);

  const movies = privateRules(new Collection({
    type: "base",
    name: "movies",
    fields: [
      ownerField(users),
      { name: "title", type: "text", required: true, max: 300 },
      { name: "titleOriginal", type: "text", max: 300 },
      { name: "mediaType", type: "select", required: true, values: ["电影", "剧集", "综艺", "纪录片", "动画"], maxSelect: 1 },
      { name: "director", type: "text", max: 300 },
      { name: "cast", type: "json", maxSize: 100000 },
      { name: "releaseDate", type: "text", max: 10 },
      { name: "country", type: "text", max: 500 },
      { name: "genre", type: "json", maxSize: 100000 },
      { name: "tags", type: "json", maxSize: 100000 },
      { name: "runtime", type: "number", min: 0, max: 10000 },
      { name: "synopsis", type: "text", max: 20000 },
      { name: "rating", type: "number", min: 0, max: 10 },
      { name: "poster", type: "file", maxSelect: 1, maxSize: 20 * 1024 * 1024, mimeTypes: ["image/jpeg", "image/png", "image/webp"], thumbs: ["300x450"], protected: true },
      { name: "status", type: "select", required: true, values: ["在看", "已看完", "想看"], maxSelect: 1 },
      { name: "progress", type: "json", maxSize: 100000 },
      { name: "rewatchCount", type: "number", min: 0, max: 1000 },
      { name: "tmdbId", type: "number", min: 0 },
    ],
  }));
  app.save(movies);

  const diaryEntries = privateRules(new Collection({
    type: "base",
    name: "diary_entries",
    fields: [
      ownerField(users),
      { name: "movie", type: "relation", required: true, collectionId: movies.id, maxSelect: 1, cascadeDelete: true },
      { name: "watchDate", type: "text", required: true, max: 10 },
      { name: "watchTime", type: "text", max: 8 },
      { name: "rating", type: "number", required: true, min: -1, max: 10 },
      { name: "review", type: "text", max: 20000 },
      { name: "kind", type: "select", required: true, values: ["progress", "status"], maxSelect: 1 },
    ],
  }));
  app.save(diaryEntries);

  const watchRecords = privateRules(new Collection({
    type: "base",
    name: "watch_records",
    fields: [
      ownerField(users),
      { name: "movie", type: "relation", required: true, collectionId: movies.id, maxSelect: 1, cascadeDelete: true },
      { name: "watchDate", type: "text", required: true, max: 10 },
      { name: "watchTime", type: "text", max: 8 },
      { name: "rating", type: "number", required: true, min: 0, max: 10 },
      { name: "review", type: "text", max: 20000 },
    ],
  }));
  app.save(watchRecords);

  const screenshots = privateRules(new Collection({
    type: "base",
    name: "screenshots",
    fields: [
      ownerField(users),
      { name: "movie", type: "relation", required: true, collectionId: movies.id, maxSelect: 1, cascadeDelete: true },
      { name: "image", type: "file", required: true, maxSelect: 1, maxSize: 30 * 1024 * 1024, mimeTypes: ["image/jpeg", "image/png", "image/webp"], thumbs: ["500x281"], protected: true },
      { name: "episode", type: "number", min: 1, max: 999 },
      { name: "hours", type: "number", min: 0, max: 23 },
      { name: "minutes", type: "number", min: 0, max: 59 },
      { name: "seconds", type: "number", min: 0, max: 59 },
    ],
  }));
  app.save(screenshots);
}, (app) => {
  for (const name of ["screenshots", "watch_records", "diary_entries", "movies"]) {
    app.delete(app.findCollectionByNameOrId(name));
  }
})

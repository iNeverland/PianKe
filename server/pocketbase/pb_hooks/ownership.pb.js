/// <reference path="../pb_data/types.d.ts" />

// Collection rules limit records by owner, but relation changes must also be
// checked: a child record may only reference a movie from the same account.
function enforceMovieOwner(e) {
  e.record.set('owner', e.auth.id);
  e.next();
}

function enforceChildOwner(e) {
  const movieId = e.record.getString('movie');
  if (!movieId) throw new BadRequestError('请选择影片');
  const movie = $app.findRecordById('movies', movieId);
  if (movie.getString('owner') !== e.auth.id) {
    throw new ForbiddenError('不能关联其他账号的影片');
  }
  e.record.set('owner', e.auth.id);
  e.next();
}

onRecordCreateRequest(enforceMovieOwner, 'movies');
onRecordUpdateRequest(enforceMovieOwner, 'movies');

for (const collection of ['diary_entries', 'watch_records', 'screenshots']) {
  onRecordCreateRequest(enforceChildOwner, collection);
  onRecordUpdateRequest(enforceChildOwner, collection);
}

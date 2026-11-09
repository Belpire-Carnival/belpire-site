import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateTitles, thumbPaths, pickThumb } from './find-ship-images.mjs';
import { withPictures, shipKind, IMG_PATH } from '../worker/sc-builder.js';

test('candidate titles try the full name, the name without its maker, then shorter names', () => {
  assert.deepEqual(candidateTitles('Crusader Mercury Star Runner', 'Crusader Industries'), [
    'Crusader Mercury Star Runner', 'Mercury Star Runner', 'Mercury Star'
  ]);
  assert.deepEqual(candidateTitles('Drake Corsair', 'Drake Interplanetary'), ['Drake Corsair', 'Corsair']);
  assert.deepEqual(candidateTitles('', 'x'), []);
});

test('thumbPaths skips placeholders, duplicates and anything that is not a media path', () => {
  const html = `<img src="//media.starcitizen.tools/thumb/a/ab/Corsair_front.jpg/400px-Corsair_front.jpg">
    <img src="https://media.starcitizen.tools/thumb/c/cd/Placeholder.png/400px-Placeholder.png">
    <img src="//media.starcitizen.tools/thumb/a/ab/Corsair_front.jpg/400px-Corsair_front.jpg">
    <img src="//evil.example/thumb/a/ab/x.jpg/400px-x.jpg"><img src="//media.starcitizen.tools/../etc/passwd">`;
  assert.deepEqual(thumbPaths(html), ['thumb/a/ab/Corsair_front.jpg/400px-Corsair_front.jpg']);
});

test('pickThumb prefers a file that names the ship', () => {
  const html = `<img src="//media.starcitizen.tools/thumb/1/11/Logo.png/400px-Logo.png">
    <img src="//media.starcitizen.tools/thumb/2/22/Corsair_pic.jpg/400px-Corsair_pic.jpg">`;
  assert.equal(pickThumb(html, 'Drake Corsair'), 'thumb/2/22/Corsair_pic.jpg/400px-Corsair_pic.jpg');
  assert.equal(pickThumb(html, 'Other'), 'thumb/1/11/Logo.png/400px-Logo.png');
  assert.equal(pickThumb('', 'x'), '');
});

test('withPictures fills only ships without a picture, and only with a valid path', () => {
  const good = 'thumb/a/ab/Corsair.jpg/400px-Corsair.jpg';
  const ships = [{ id: 'a', img: 'keep' }, { id: 'b', img: '' }, { id: 'c', img: '' }, { id: 'd', img: '' }];
  const out = withPictures(ships, { a: good, b: good, c: '../../evil', d: 5 });
  assert.equal(out[0].img, 'keep');
  assert.equal(out[1].img, good);
  assert.ok(IMG_PATH.test(out[1].img));
  assert.equal(out[2].img, '');
  assert.equal(out[3].img, '');
  assert.deepEqual(withPictures(null, {}), []);
});

test('shipKind separates spaceships, grav vehicles and ground vehicles', () => {
  assert.equal(shipKind({ is_spaceship: true, is_vehicle: true }), 'ship');
  assert.equal(shipKind({ is_gravlev: true, is_vehicle: true }), 'gravlev');
  assert.equal(shipKind({ is_vehicle: true }), 'ground');
  assert.equal(shipKind({}), 'ship');
});

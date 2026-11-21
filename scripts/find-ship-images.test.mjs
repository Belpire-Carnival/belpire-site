import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateTitles, thumbPaths, pickThumb, cleanMediaPath } from './find-ship-images.mjs';
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
    <img src="//media.starcitizen.tools/e/e8/CdxIconSuccess.svg"><img src="//media.starcitizen.tools/thumb/e/e8/Icon.svg/40px-Icon.svg.png">
    <img src="//evil.example/thumb/a/ab/x.jpg/400px-x.jpg"><img src="//media.starcitizen.tools/../etc/passwd">`;
  assert.deepEqual(thumbPaths(html), ['thumb/a/ab/Corsair_front.jpg/400px-Corsair_front.jpg']);
});

test('pickThumb prefers a file that names the ship', () => {
  const html = `<img src="//media.starcitizen.tools/thumb/1/11/Logo.png/400px-Logo.png">
    <img src="//media.starcitizen.tools/thumb/2/22/Corsair_pic.jpg/400px-Corsair_pic.jpg">`;
  assert.equal(pickThumb(html, 'Drake Corsair'), 'thumb/2/22/Corsair_pic.jpg/400px-Corsair_pic.jpg');
  assert.equal(pickThumb(html, 'Other'), '');
  assert.equal(pickThumb('', 'x'), '');
  const two = `<img src="//media.starcitizen.tools/thumb/3/33/Cutlass_Blue.jpg/400px-Cutlass_Blue.jpg"><img src="//media.starcitizen.tools/thumb/4/44/Cutlass_Black_front.jpg/400px-Cutlass_Black_front.jpg">`;
  assert.equal(pickThumb(two, 'Drake Cutlass Black'), 'thumb/4/44/Cutlass_Black_front.jpg/400px-Cutlass_Black_front.jpg');
  assert.equal(pickThumb(two, 'Cutlass Blue'), 'thumb/3/33/Cutlass_Blue.jpg/400px-Cutlass_Blue.jpg');
  assert.equal(pickThumb(`<img src="//media.starcitizen.tools/thumb/5/55/Version_2.jpg/400px-Version_2.jpg">`, 'Ares Ion'), '');
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

test('the wiki page markup is cleaned: cache tags, entities and the .webp tail', () => {
  assert.equal(cleanMediaPath('thumb/1/1d/Corsair_in_space_-_Isometric.jpg/256px-Corsair_in_space_-_Isometric.jpg.webp?jvvdm'), 'thumb/1/1d/Corsair_in_space_-_Isometric.jpg/256px-Corsair_in_space_-_Isometric.jpg');
  assert.equal(cleanMediaPath('b/be/Sc-icon-uec.svg?5jxj6&quot;;'), 'b/be/Sc-icon-uec.svg');
  assert.equal(cleanMediaPath('8/85/Star&#95;Citizen&#95;Logo.svg?e3zbe&quot;;'), '8/85/Star_Citizen_Logo.svg');
});

test('real page markup: photos are found at the nearest size to 400 px, icons and originals are not', () => {
  const html = `<img src="//media.starcitizen.tools/thumb/0/0e/SC-3.17_Corsair_Concept_Art_Recreation.png/400px-SC-3.17_Corsair_Concept_Art_Recreation.png.webp?c0u3a" srcset="//media.starcitizen.tools/thumb/0/0e/SC-3.17_Corsair_Concept_Art_Recreation.png/800px-SC-3.17_Corsair_Concept_Art_Recreation.png.webp?c0u3a 2x">
    <a href="//media.starcitizen.tools/0/0e/SC-3.17_Corsair_Concept_Art_Recreation.png?c0u3a">orig</a>
    ".x{background:url(//media.starcitizen.tools/b/be/Sc-icon-uec.svg?5jxj6&quot;);}"
    <img src="//media.starcitizen.tools/thumb/1/1d/Corsair_in_space_-_Isometric.jpg/128px-Corsair_in_space_-_Isometric.jpg.webp?jvvdm" srcset="//media.starcitizen.tools/thumb/1/1d/Corsair_in_space_-_Isometric.jpg/256px-Corsair_in_space_-_Isometric.jpg.webp?jvvdm 2x">`;
  assert.deepEqual(thumbPaths(html), [
    'thumb/0/0e/SC-3.17_Corsair_Concept_Art_Recreation.png/400px-SC-3.17_Corsair_Concept_Art_Recreation.png',
    'thumb/1/1d/Corsair_in_space_-_Isometric.jpg/256px-Corsair_in_space_-_Isometric.jpg'
  ]);
  assert.equal(pickThumb(html, 'Drake Corsair'), 'thumb/1/1d/Corsair_in_space_-_Isometric.jpg/256px-Corsair_in_space_-_Isometric.jpg');
  assert.ok(thumbPaths(html).every((p) => IMG_PATH.test(p)));
});

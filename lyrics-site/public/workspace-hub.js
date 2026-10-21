import { node, button } from './ui.js';
import { transferState } from './cloud-transfers.js';

const labels = { current: 'На этом устройстве · В облаке', 'local-changes': 'Есть изменения на этом устройстве', 'cloud-changes': 'В облаке новая версия', conflict: 'Обе версии изменены', local: 'На этом устройстве' };
export function createWorkspaceHub({ state, actions }) {
  let destination = 'projects';
  const $ = selector => document.querySelector(selector);
  function show(next = destination) {
    destination = next;
    actions.leaveEditor();
    $('#home-view').hidden = false; $('#preparation-view').hidden = true;
    $('#projects').setAttribute('aria-current', destination === 'projects' ? 'page' : 'false');
    $('#library').setAttribute('aria-current', destination === 'library' ? 'page' : 'false');
    $('#hub-search').value = ''; render(); actions.refresh();
  }
  function render() {
    const data = state(), isProjects = destination === 'projects';
    $('#hub-title').textContent = isProjects ? 'Проекты' : 'Библиотека песен';
    $('#hub-description').textContent = isProjects ? 'Соберите программу и запускайте музыку и тексты на выступлении.' : 'Подготовьте песни один раз и используйте их в разных проектах.';
    $('#hub-search').placeholder = isProjects ? 'Найти проект' : 'Название или исполнитель';
    $('#hub-search').setAttribute('aria-label', isProjects ? 'Поиск проектов' : 'Поиск песен');
    $('#hub-create').textContent = isProjects ? '+ Создать проект' : '+ Добавить песню';
    const query = $('#hub-search').value.trim().toLocaleLowerCase();
    const filter = $('#hub-filter').value;
    const localItems = isProjects ? data.projects : data.library;
    const cloudItems = isProjects ? data.cloudProjects : data.cloudSongs;
    const kind = isProjects ? 'project' : 'song';
    const linkedIds = new Set(localItems.map(item => data.links[`${kind}:${item.id}`]?.id).filter(Boolean));
    const cards = [];
    const matches = item => `${item.name || item.title || ''} ${item.artist || ''}`.toLocaleLowerCase().includes(query);
    for (const item of localItems) {
      const link = data.links[`${kind}:${item.id}`];
      if (filter === 'cloud' && !link || !matches(item)) continue;
      const cloud = cloudItems.find(entry => entry.id === link?.id);
      const status = transferState(item, link, isProjects ? cloud?.revision : cloud?.revisionId);
      const controls = [button('Открыть', 'button primary', () => isProjects ? actions.openProject(item.id) : actions.openSong(item.id))];
      if (isProjects) controls.push(button('▶ Запустить', 'button quiet', () => actions.play(item.id)));
      if (data.session) {
        controls.push(button(link ? 'Обновить в облаке' : 'Загрузить в облако', 'button quiet', () => actions.upload(kind, item.id)));
        if (link && ['cloud-changes', 'conflict'].includes(status)) controls.push(button('Скачать версию из облака', 'button quiet', () => actions.download(kind, link.id)));
        if (link) controls.push(button('Создать отдельную копию', 'button quiet', () => actions.copy(kind, item.id)));
      }
      controls.push(button('Удалить', 'button danger', () => actions.remove(kind, item.id)));
      const subtitle = isProjects ? `${item.songs.length} песен · ${Math.ceil(item.songs.reduce((sum, song) => sum + (song.duration || 0), 0) / 60)} мин` : item.artist || 'Без исполнителя';
      const readiness = node('p', { className: 'hub-readiness', text: isProjects ? 'Проверка готовности…' : `${item.cues.length ? 'Текст ✓' : 'Без текста'} · ${item.backing?.fileName ? 'Минусовка ✓' : 'Без минусовки'}` });
      const card = node('article', { className: 'hub-card', 'data-local-id': item.id }, [node('span', { className: 'eyebrow', text: isProjects ? 'ПРОЕКТ' : 'ПЕСНЯ' }), node('h2', { text: item.name || item.title || 'Без названия' }), node('p', { className: 'hint', text: subtitle }), node('p', { className: `storage-badge ${status}`, text: labels[status] }), readiness, node('div', { className: 'hub-card-actions' }, controls)]);
      cards.push(card);
      if (isProjects) actions.readiness(item).then(text => { if (card.isConnected) readiness.textContent = text; }).catch(() => { readiness.textContent = 'Файлы недоступны — подключите папку'; });
    }
    if (data.session && filter !== 'local') for (const item of cloudItems) {
      if (linkedIds.has(item.id) || !matches(item)) continue;
      cards.push(node('article', { className: 'hub-card cloud', 'data-cloud-id': item.id }, [node('span', { className: 'eyebrow', text: 'В ОБЛАКЕ' }), node('h2', { text: item.name || item.title || 'Без названия' }), node('p', { className: 'hint', text: isProjects ? `${item.songCount} песен · Для запуска нужен интернет` : item.artist || 'Без исполнителя' }), node('div', { className: 'hub-card-actions' }, [button('Открыть', 'button quiet', () => isProjects ? actions.openCloudProject(item.id) : actions.openCloudSong(item.id)), button(isProjects ? '↓ Скачать для выступления' : '↓ Скачать на это устройство', 'button primary', () => actions.download(kind, item.id))])]));
    }
    if (!cards.length) cards.push(node('div', { className: 'hub-empty' }, [node('span', { className: 'empty-note', text: isProjects ? '♫' : '♪' }), node('h2', { text: query ? 'Ничего не найдено' : isProjects ? 'Здесь начинается ваше выступление' : 'Соберите свою библиотеку' }), node('p', { className: 'hint', text: query ? 'Попробуйте другое название или фильтр.' : isProjects ? 'Создайте проект, добавьте песни и расставьте их в нужном порядке.' : 'Добавьте текст, минусовку или оба компонента песни.' })]));
    $('#hub-list').replaceChildren(...cards);
    $('#hub-message').textContent = data.message || (!data.session ? 'Работайте без аккаунта. Войдите, когда понадобится облако.' : 'Обмен с облаком выполняется по вашей команде.');
  }
  $('#hub-create').addEventListener('click', () => destination === 'projects' ? actions.createProject() : actions.createSong());
  $('#hub-search').addEventListener('input', render); $('#hub-filter').addEventListener('change', render);
  return { show, render, destination: () => destination };
}

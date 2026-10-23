import { node, button } from './ui.js';
import { validateSong } from './core.js';
import { DEFAULT_LIBRARY_SORT, LIBRARY_SORTS, sortLibrarySongs } from './library-sort.js';

export function createWorkspaceHub({ state, actions }) {
  let destination = 'projects';
  let tooltipId = 0;
  const $ = selector => document.querySelector(selector);
  const sortSelect = node('select', { id: 'hub-library-sort', 'aria-label': 'Сортировка песен' }, LIBRARY_SORTS.map(option => node('option', { value: option.value, text: option.label })));
  let savedSort = null;
  try { savedSort = sessionStorage.getItem('kaada-library-sort'); } catch {}
  sortSelect.value = LIBRARY_SORTS.some(option => option.value === savedSort) ? savedSort : DEFAULT_LIBRARY_SORT;
  const sortLabel = node('label', { className: 'hub-sort-label' }, [node('span', { text: 'Сортировка' }), sortSelect]);
  $('#hub-search').parentElement.after(sortLabel);
  function iconButton(icon, label, className, onClick) {
    const control = button('', `button quiet event-icon-button action-icon-button has-tooltip ${className}`, onClick);
    control.setAttribute('aria-label', label); control.setAttribute('data-tooltip', label); control.title = label;
    control.append(node('span', { className: 'hub-action-glyph', text: ({ play: '▶', download: '↓', trash: '×', copy: '⧉' })[icon] || '•', 'aria-hidden': 'true' }));
    return control;
  }
  function cardIcon(kind) {
    if (kind !== 'project') return node('span', { className: 'hub-card-icon', 'aria-hidden': 'true', text: '♫' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const folder = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    folder.setAttribute('d', 'M3 7V5a1 1 0 0 1 1-1h5l3 3h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z');
    svg.append(folder);
    return node('span', { className: 'hub-card-icon project-card-icon' }, [svg]);
  }
  async function show(next = destination) {
    if (await actions.leaveEditor?.() === false) return false;
    destination = next;
    $('#home-view').hidden = false; $('#preparation-view').hidden = true;
    $('#projects').setAttribute('aria-current', destination === 'projects' ? 'page' : 'false');
    $('#library').setAttribute('aria-current', destination === 'library' ? 'page' : 'false');
    $('#hub-search').value = ''; render(); actions.refresh();
    return true;
  }
  function songPlayControl(item) {
    const song = item.song || (Array.isArray(item.cues) ? item : null);
    const ready = song ? !validateSong(song).length : item.reviewed === true && item.valid === true;
    const control = iconButton('play', 'Запустить', '', () => actions.playCloudSong(item.id));
    if (ready) return control;
    control.disabled = true;
    const id = `hub-play-tooltip-${++tooltipId}`;
    return node('span', { className: 'hub-disabled-play', tabindex: '0', role: 'group', 'aria-label': 'Запустить песню', 'aria-describedby': id }, [
      control,
      node('span', { className: 'hub-play-tooltip', id, role: 'tooltip', text: 'подтвердите готовность песни' }),
    ]);
  }
  function songMetadata(item) {
    return [
      node('p', { className: 'hub-card-meta', text: item.artist || 'Без исполнителя' }),
      item.album ? node('p', { className: 'hub-card-meta hub-album', text: item.album }) : null,
      item.version ? node('p', { className: 'hub-card-meta hub-recording-version', text: `Версия записи: ${item.version}` }) : null,
    ].filter(Boolean);
  }
  function makeOpenCard(card, label, open) {
    card.tabIndex = 0;
    card.setAttribute('aria-label', `Открыть ${label}`);
    card.addEventListener('click', event => {
      if (event.target.closest('button,a,input,select,textarea,[role="button"],.hub-card-actions,.hub-disabled-play')) return;
      open();
    });
    card.addEventListener('keydown', event => {
      if (event.target !== card || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault(); open();
    });
    return card;
  }
  function render() {
    const data = state(), isProjects = destination === 'projects';
    $('#hub-title').textContent = isProjects ? 'Проекты' : 'Библиотека песен';
    $('#hub-description').textContent = isProjects ? 'Соберите программу и запускайте музыку и тексты на выступлении.' : 'Подготовьте песни в облаке и используйте их в разных проектах.';
    $('#hub-search').placeholder = isProjects ? 'Найти проект' : 'Название, исполнитель или версия записи';
    $('#hub-search').setAttribute('aria-label', isProjects ? 'Поиск проектов' : 'Поиск песен по названию, исполнителю или версии записи');
    $('#hub-create').textContent = isProjects ? '+ Создать проект' : '+ Новая песня';
    sortLabel.hidden = isProjects;
    const query = $('#hub-search').value.trim().toLocaleLowerCase();
    const localItems = isProjects ? data.projects : [];
    const cloudItems = isProjects ? data.cloudProjects : sortLibrarySongs(data.cloudSongs, sortSelect.value);
    const linkedIds = new Set(localItems.map(item => data.links[`project:${item.id}`]?.id).filter(Boolean));
    const cards = [];
    const matches = item => `${item.name || item.title || ''} ${item.artist || ''} ${item.album || ''} ${item.version || ''}`.toLocaleLowerCase().includes(query);
    for (const item of localItems) {
      const link = data.links[`project:${item.id}`];
      const cloud = cloudItems.find(entry => entry.id === link?.id);
      const metadata = cloud || item;
      if (!matches(metadata)) continue;
      const controls = [
        iconButton('play', 'Запустить', '', () => actions.play(item.id)),
      ];
      if (link && data.session) {
        controls.push(iconButton('download', 'Сохранить локальную копию', '', () => actions.download('project', link.id)));
        controls.push(iconButton('trash', 'Удалить проект', 'danger', () => actions.removeCloudProject(link.id)));
      } else if (!link) controls.push(iconButton('trash', 'Удалить проект', 'danger', () => actions.remove('project', item.id)));
      const subtitle = `${item.songs.length} песен · ${Math.ceil(item.songs.reduce((sum, song) => sum + (song.duration || 0), 0) / 60)} мин`;
      const readiness = node('p', { className: 'hub-readiness', text: 'Проверка готовности…' });
      const card = makeOpenCard(node('article', { className: `hub-card${metadata.cover ? ' project-cover-card' : ''}`, 'data-local-id': item.id, 'data-cloud-id': link?.id }, [
        node('div', { className: 'hub-card-top' }, [node('span', { className: 'eyebrow', text: 'ПРОЕКТ' }), cardIcon('project')]),
        node('h2', { text: metadata.name || 'Без названия' }),
        metadata.cover ? node('img', { className: 'hub-card-cover', src: metadata.cover, alt: 'Обложка проекта' }) : null,
        node('p', { className: 'hub-card-meta', text: subtitle }),
        node('p', { className: 'storage-badge', text: link ? 'В облаке · Есть локальная копия' : 'На этом устройстве' }),
        readiness,
        node('div', { className: 'hub-card-actions' }, controls),
      ]), `проект ${metadata.name || 'Без названия'}`, () => actions.openProject(item.id));
      cards.push(card);
      actions.readiness(item).then(text => { if (card.isConnected) readiness.textContent = text; }).catch(() => { if (card.isConnected) readiness.textContent = 'Файлы недоступны — подключите папку'; });
    }
    if (data.session) for (const item of cloudItems) {
      if ((isProjects && linkedIds.has(item.id)) || !matches(item)) continue;
      const controls = isProjects ? [
        iconButton('play', 'Запустить', '', () => actions.playCloudProject(item.id)),
        iconButton('download', 'Сохранить локальную копию', '', () => actions.download('project', item.id)),
        iconButton('trash', 'Удалить проект', 'danger', () => actions.removeCloudProject(item.id)),
      ] : [
        songPlayControl(item),
        (() => {
          const copy = iconButton('copy', 'Создать копию', '', () => actions.createLibraryCopy(item));
          if (item.reviewed === true && item.valid === true) return copy;
          copy.disabled = true;
          copy.title = 'подтвердите готовность песни';
          copy.setAttribute('aria-label', 'Создать копию. Подтвердите готовность песни.');
          copy.setAttribute('data-tooltip', 'Создать копию. Подтвердите готовность песни.');
          return copy;
        })(),
        iconButton('trash', 'Удалить песню', 'danger', () => actions.removeCloudSong(item.id)),
      ];
      const songInfo = item.song || item;
      cards.push(makeOpenCard(node('article', { className: `hub-card cloud${isProjects ? (item.cover ? ' project-cover-card' : '') : ' song-cover-card'}`, 'data-cloud-id': item.id }, [
        node('div', { className: 'hub-card-top' }, [node('span', { className: 'eyebrow', text: isProjects ? 'ПРОЕКТ' : 'ПЕСНЯ' }), cardIcon(isProjects ? 'project' : 'song')]),
        node('h2', { text: item.name || item.title || 'Без названия' }),
        ...(isProjects ? [node('p', { className: 'hub-card-meta', text: `${item.songCount} песен` })] : songMetadata(item)),
        isProjects && item.cover ? node('img', { className: 'hub-card-cover', src: item.cover, alt: 'Обложка проекта' }) : null,
        !isProjects && songInfo.cover ? node('img', { className: 'hub-card-cover', src: songInfo.cover, alt: 'Обложка песни' }) : null,
        node('p', { className: 'storage-badge', text: 'В облаке' }),
        node('div', { className: 'hub-card-actions' }, controls),
      ]), `${isProjects ? 'проект' : 'песню'} ${item.name || item.title || 'Без названия'}`, () => isProjects ? actions.openCloudProject(item.id) : actions.openCloudSong(item.id)));
    }
    if (!cards.length) cards.push(node('div', { className: 'hub-empty' }, [
      node('span', { className: 'empty-note', text: isProjects ? '♫' : '♪' }),
      node('h2', { text: query ? 'Ничего не найдено' : !data.session && !isProjects ? 'Войдите, чтобы открыть библиотеку' : isProjects ? 'Здесь начинается ваше выступление' : 'Соберите свою библиотеку' }),
      node('p', { className: 'hint', text: query ? 'Попробуйте другое название или фильтр.' : !data.session && !isProjects ? 'Песни сохраняются в вашей облачной библиотеке.' : isProjects ? 'Создайте проект, добавьте песни и расставьте их в нужном порядке.' : 'Добавьте текст, минусовку или оба компонента песни.' }),
    ]));
    $('#hub-list').replaceChildren(...cards);
    $('#hub-message').textContent = data.message || (!data.session ? 'Войдите для доступа к облачной библиотеке и проектам.' : 'Песни хранятся в облаке. Локальные копии проектов сохраняются в выбранную папку.');
  }
  $('#hub-create').addEventListener('click', () => destination === 'projects' ? actions.createProject() : actions.createSong());
  $('#hub-search').addEventListener('input', render);
  sortSelect.addEventListener('change', () => {
    try { sessionStorage.setItem('kaada-library-sort', sortSelect.value); } catch {}
    render();
  });
  return { show, render, destination: () => destination };
}

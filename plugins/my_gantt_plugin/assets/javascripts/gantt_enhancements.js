document.addEventListener('DOMContentLoaded', function () {
  if (!document.body.classList.contains('controller-gantts')) return;

  addRangeSwitcher();
  addTicketInfoColumn();
});

function addRangeSwitcher() {
  const content = document.querySelector('#content h2');
  if (!content || document.querySelector('.gantt-range-switcher')) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'gantt-range-switcher';
  wrapper.innerHTML = `
    <span class="label">表示範囲:</span>
    <button data-zoom="4" data-months="1">日</button>
    <button data-zoom="2" data-months="1">週</button>
    <button data-zoom="1" data-months="3">月</button>
    <button data-action="today">今日</button>
  `;

  wrapper.addEventListener('click', function (event) {
    if (event.target.tagName !== 'BUTTON') return;
    if (event.target.getAttribute('data-action') === 'today') {
      if (window.ganttChart && typeof window.ganttChart.scrollToToday === 'function') {
        window.ganttChart.scrollToToday();
      } else {
        // Fallback: リロード
        window.location.reload();
      }
      return;
    }
    const zoom = event.target.getAttribute('data-zoom');
    const months = event.target.getAttribute('data-months');

    const url = new URL(window.location.href);
    url.searchParams.set('zoom', zoom);
    url.searchParams.set('months', months);
    window.location.assign(url.toString());
  });

  content.parentNode.insertBefore(wrapper, content.nextSibling);
}

function addTicketInfoColumn() {
  // Gantt DOMが描画されるまで待ちつつ一度だけ追加
  const tryRender = () => {
    const rendered = renderTicketInfoColumn();
    return rendered;
  };

  if (tryRender()) return;

  // 遅延描画に備えて軽めの監視を行う（最大3秒）
  const observer = new MutationObserver(() => {
    if (tryRender()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 3000);
}

function renderTicketInfoColumn() {
  const subjectsContainer = document.querySelector('.gantt_subjects_container');
  const ganttArea = document.getElementById('gantt_area');
  const layoutRow = ganttArea ? ganttArea.closest('tr') : null;
  const subjectCell = subjectsContainer ? subjectsContainer.closest('td') : null;

  if (!subjectsContainer || !layoutRow) return false;

  // 既存列を再生成する場合はいったん除去
  const existing = layoutRow.querySelector('.gantt-ticket-info-column');
  if (existing) existing.remove();

  const issueSubjects = subjectsContainer.querySelectorAll('.issue-subject');
  if (!issueSubjects.length) return false;

  const headerBlocks = subjectsContainer.querySelectorAll('.gantt_hdr');
  const headerHeight = headerBlocks[0] ? headerBlocks[0].offsetHeight : 18;
  const overlayHeight = headerBlocks[1] ? headerBlocks[1].offsetHeight : headerHeight;
  const containerHeight = subjectsContainer.offsetHeight;

  const timelineCell = ganttArea ? ganttArea.closest('td') : null;
  const targetWidth = 220;

  const td = document.createElement('td');
  td.className = 'gantt-ticket-info-column';
  td.style.verticalAlign = 'top';
  td.style.width = `${targetWidth}px`;

  const wrapper = document.createElement('div');
  wrapper.className = 'gantt_ticket_info_container gantt_selected_column_container';
  wrapper.style.position = 'relative';
  wrapper.style.height = `${containerHeight}px`;
  wrapper.style.width = `${targetWidth}px`;

  const overlay = document.createElement('div');
  overlay.className = 'gantt_hdr';
  overlay.style.height = `${overlayHeight}px`;
  overlay.style.overflow = 'hidden';
  wrapper.appendChild(overlay);

  const header = document.createElement('div');
  header.className = 'gantt_hdr';
  header.style.height = `${headerHeight}px`;
  header.style.background = '#f1f3f5';
  const headerLabel = document.createElement('p');
  headerLabel.className = 'gantt_hdr_selected_column_name';
  headerLabel.textContent = 'チケット情報';
  header.appendChild(headerLabel);
  wrapper.appendChild(header);

  const content = document.createElement('div');
  content.className = 'gantt_ticket_info gantt_selected_column_content';
  content.style.position = 'relative';
  content.style.height = `${containerHeight - overlayHeight - headerHeight}px`;
  content.style.overflow = 'hidden';
  wrapper.appendChild(content);

  issueSubjects.forEach(function (subject) {
    const subjectLink = subject.querySelector('a[href*="/issues/"]');
    const issueId = subject.id
      ? subject.id.replace('issue-', '')
      : (subjectLink ? (subjectLink.href.match(/issues\/(\d+)/) || [])[1] : null);
    if (!subjectLink || !issueId) return;

    const row = document.createElement('div');
    row.className = 'ticket-info-row';
    row.style.position = 'absolute';
    row.style.left = '0';
    row.style.width = '100%';
    const top = subject.style.top || `${subject.offsetTop}px`;
    row.style.top = top;

    const link = document.createElement('a');
    link.href = `/issues/${issueId}/edit`;
    link.textContent = subjectLink.textContent.trim();
    link.title = 'チケットを編集';

    row.appendChild(link);
    content.appendChild(row);
  });

  td.appendChild(wrapper);
  const insertBeforeTarget = subjectCell ?
    subjectCell.nextElementSibling || timelineCell :
    timelineCell;
  layoutRow.insertBefore(td, insertBeforeTarget);
  return true;
}

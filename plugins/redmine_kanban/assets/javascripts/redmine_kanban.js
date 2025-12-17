(function () {
  function csrfToken() {
    var meta = document.querySelector("meta[name='csrf-token']");
    return meta ? meta.getAttribute('content') : null;
  }

  function parseISODate(dateString) {
    if (!dateString) return null;
    var parts = dateString.split('-');
    if (parts.length !== 3) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function startOfWeek(date) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var day = (d.getDay() + 6) % 7; // Monday=0
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function endOfWeek(date) {
    var s = startOfWeek(date);
    var e = new Date(s);
    e.setDate(e.getDate() + 7);
    e.setMilliseconds(e.getMilliseconds() - 1);
    return e;
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(text || ''));
    return div.innerHTML;
  }

  function byId(arr, id) {
    for (var i = 0; i < arr.length; i++) {
      if (String(arr[i].id) === String(id)) return arr[i];
    }
    return null;
  }

  function buildSelect(options, selected) {
    var html = '';
    for (var i = 0; i < options.length; i++) {
      var opt = options[i];
      var sel = String(opt.id) === String(selected) ? " selected='selected'" : '';
      var label = escapeHtml(opt.name);
      html += "<option value='" + (opt.id === null ? '' : opt.id) + "'" + sel + '>' + label + '</option>';
    }
    return html;
  }

  function init(root) {
    var dataUrl = root.getAttribute('data-data-url');
    if (!dataUrl) return;

    var state = {
      data: null,
      filters: {
        assignee: 'all',
        q: '',
        due: 'all'
      },
      drag: null,
    };

    function fetchData() {
      root.innerHTML = '読み込み中...';
      window.jQuery
        .getJSON(dataUrl)
        .done(function (data) {
          state.data = data;
          render();
        })
        .fail(function (xhr) {
          var msg = (xhr.responseJSON && xhr.responseJSON.message) || '読み込みに失敗しました';
          root.innerHTML = "<div class='error'>" + escapeHtml(msg) + '</div>';
        });
    }

    function render() {
      if (!state.data || !state.data.ok) {
        root.innerHTML = "<div class='error'>データ取得に失敗しました</div>";
        return;
      }

      var meta = state.data.meta;
      var columns = state.data.columns;
      var lanes = state.data.lanes;
      var issues = filteredIssues(state.data.issues);
      var statusInfo = {};
      for (var i = 0; i < columns.length; i++) {
        statusInfo[String(columns[i].id)] = { is_closed: !!columns[i].is_closed, wip_limit: columns[i].wip_limit || null };
      }

      root.innerHTML = [
        "<div class='rk-toolbar'>",
        toolbarHtml(),
        '</div>',
        "<div class='rk-board'>",
        boardHtml(columns, lanes, issues, meta, statusInfo),
        '</div>',
        modalHtml(),
        "<div class='rk-modal-backdrop' id='rk-modal-backdrop'></div>",
      ].join('');

      bindToolbar();
      bindDnD(meta);
      bindAddButtons(meta);
    }

    function toolbarHtml() {
      var meta = state.data.meta;
      var assignees = state.data.lists.assignees || [];

      var assigneeOptions = [{ id: 'all', name: '全員' }, { id: 'me', name: '自分' }, { id: 'unassigned', name: '未割当' }].concat(
        assignees
          .filter(function (a) {
            return a.id !== null;
          })
          .map(function (a) {
            return { id: String(a.id), name: a.name };
          })
      );

      var laneLabel = meta.lane_type === 'assignee' ? '担当者' : '対象';

      return [
        "<span class='rk-field'><strong>" + laneLabel + "</strong>",
        "<select id='rk-filter-assignee'>" + buildSelect(assigneeOptions, state.filters.assignee) + '</select></span>',
        "<span class='rk-field'><strong>検索</strong><input id='rk-filter-q' type='text' value='" + escapeHtml(state.filters.q) + "' /></span>",
        "<span class='rk-field'><strong>期限</strong>",
        "<select id='rk-filter-due'>",
        buildSelect(
          [
            { id: 'all', name: 'すべて' },
            { id: 'overdue', name: '期限切れ' },
            { id: 'thisweek', name: '今週' },
            { id: 'none', name: '未設定' },
          ],
          state.filters.due
        ),
        '</select></span>',
      ].join('');
    }

    function filteredIssues(issues) {
      var q = (state.filters.q || '').toLowerCase();
      var now = new Date();
      var thisWeekStart = startOfWeek(now);
      var thisWeekEnd = endOfWeek(now);

      return (issues || []).filter(function (it) {
        if (q) {
          if ((it.subject || '').toLowerCase().indexOf(q) === -1) return false;
        }

        if (state.filters.assignee !== 'all') {
          if (state.filters.assignee === 'me') {
            if (String(it.assigned_to_id) !== String(state.data.meta.current_user_id)) return false;
          } else if (state.filters.assignee === 'unassigned') {
            if (it.assigned_to_id !== null) return false;
          } else {
            if (String(it.assigned_to_id) !== String(state.filters.assignee)) return false;
          }
        }

        if (state.filters.due !== 'all') {
          if (!it.due_date) {
            if (state.filters.due !== 'none') return false;
          } else {
            var d = parseISODate(it.due_date);
            if (!d) return false;
            var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            if (state.filters.due === 'overdue') {
              if (d >= today) return false;
            }
            if (state.filters.due === 'thisweek') {
              if (d < thisWeekStart || d > thisWeekEnd) return false;
            }
            if (state.filters.due === 'none') return false;
          }
        }

        return true;
      });
    }

    function boardHtml(columns, lanes, issues, meta, statusInfo) {
      var laneType = meta.lane_type;
      var canMove = !!meta.can_move;
      var canCreate = !!meta.can_create;

      var colHeaders = columns
        .map(function (c) {
          var count = c.count || 0;
          var limit = c.wip_limit;
          var over = limit && count > limit;
          var wipText = limit ? count + ' / ' + limit : String(count);
          return [
            "<div class='rk-col-header' data-col-id='" + c.id + "'>",
            "<div class='rk-col-title'>" + escapeHtml(c.name) + "</div>",
            "<div style='display:flex; gap:6px; align-items:center;'>",
            "<div class='rk-wip " + (over ? 'rk-wip-over' : '') + "' title='WIP'>" + escapeHtml(wipText) + '</div>',
            '</div>',
            '</div>',
          ].join('');
        })
        .join('');

      if (laneType === 'none') {
        return [
          "<div class='rk-grid'>",
          columns
            .map(function (c) {
              return (
                "<div class='rk-column' data-col='" +
                c.id +
                "'>" +
                colHeadersForSingleLane(c, canCreate) +
                cellHtml('none', c.id, issuesForCell(issues, null, c.id), meta, statusInfo) +
                '</div>'
              );
            })
            .join(''),
          '</div>',
        ].join('');
      }

      // lane grid with labels
      var headerRow = "<div class='rk-lanes'><div></div><div class='rk-cells'>" + colHeaders + '</div></div>';

      var body = lanes
        .map(function (lane) {
          var cellsHtml = columns
            .map(function (c) {
              return cellHtml(lane.id, c.id, issuesForCell(issues, lane, c.id), meta, statusInfo);
            })
            .join('');
          return "<div class='rk-lanes'><div class='rk-lane-label'>" + escapeHtml(lane.name) + "</div><div class='rk-cells'>" + cellsHtml + '</div></div>';
        })
        .join('');

      return headerRow + body;

      function colHeadersForSingleLane(column, canCreate) {
        var limit = column.wip_limit;
        var count = column.count || 0;
        var over = limit && count > limit;
        var wipText = limit ? count + ' / ' + limit : String(count);
        return [
          "<div class='rk-col-header' data-col-id='" + column.id + "'>",
          "<div class='rk-col-title'>" + escapeHtml(column.name) + "</div>",
          "<div style='display:flex; gap:6px; align-items:center;'>",
          "<div class='rk-wip " + (over ? 'rk-wip-over' : '') + "' title='WIP'>" + escapeHtml(wipText) + '</div>',
          '</div>',
          '</div>',
        ].join('');
      }
    }

    function issuesForCell(issues, lane, statusId) {
      return (issues || []).filter(function (it) {
        if (String(it.status_id) !== String(statusId)) return false;
        if (!lane || lane.id === 'none') return true;
        if (lane.id === 'unassigned') return it.assigned_to_id === null;
        return String(it.assigned_to_id) === String(lane.assigned_to_id);
      });
    }

    function cellHtml(laneId, statusId, issues, meta, statusInfo) {
      var canMove = !!meta.can_move;
      var canCreate = !!meta.can_create;
      var warnDays = meta.aging_warn_days;
      var dangerDays = meta.aging_danger_days;
      var isClosed = statusInfo[String(statusId)] ? statusInfo[String(statusId)].is_closed : false;

      var cards = issues
        .map(function (it) {
          var due = it.due_date ? parseISODate(it.due_date) : null;
          var today = new Date();
          var today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
          var overdue = due && due < today0;

          var agingClass = '';
          var agingEnabled = !(meta.aging_exclude_closed && isClosed);
          if (agingEnabled) {
            if (it.aging_days >= dangerDays) agingClass = 'rk-aging-danger';
            else if (it.aging_days >= warnDays) agingClass = 'rk-aging-warn';
          }

          var badges = [];
          if (it.due_date) {
            badges.push("<span class='rk-badge " + (overdue ? 'rk-overdue' : '') + "' title='期日'>" + escapeHtml(it.due_date) + '</span>');
          } else {
            badges.push("<span class='rk-badge' title='期日'>未設定</span>");
          }
          if (it.priority_name) {
            badges.push("<span class='rk-badge' title='優先度'>" + escapeHtml(it.priority_name) + '</span>');
          }
          if (typeof it.aging_days === 'number') {
            badges.push("<span class='rk-badge " + agingClass + "' title='停滞'>" + escapeHtml(String(it.aging_days) + 'd') + '</span>');
          }
          var assignee = it.assigned_to_name ? it.assigned_to_name : '未割当';

          return [
            "<div class='rk-card' draggable='" + (canMove ? 'true' : 'false') + "' data-issue-id='" + it.id + "' data-status-id='" + it.status_id + "' data-assigned-to-id='" + (it.assigned_to_id === null ? '' : it.assigned_to_id) + "'>",
            "<div class='rk-card-title'><a href='" + escapeHtml(it.urls.issue) + "' target='_blank' rel='noopener noreferrer'>#" + it.id + '</a> ' + escapeHtml(it.subject) + '</div>',
            "<div class='rk-card-meta'><span class='rk-badge' title='担当者'>" + escapeHtml(assignee) + '</span>' + badges.join('') + '</div>',
            '</div>',
          ].join('');
        })
        .join('');

      var add = canCreate
        ? "<button type='button' class='rk-add rk-add-cell' data-status-id='" + statusId + "' data-lane-id='" + laneId + "'>＋ この列に追加</button>"
        : '';

      return "<div class='rk-cell' data-drop-status-id='" + statusId + "' data-drop-lane-id='" + laneId + "'>" + add + cards + '</div>';
    }

    function bindToolbar() {
      var assignee = document.getElementById('rk-filter-assignee');
      var q = document.getElementById('rk-filter-q');
      var due = document.getElementById('rk-filter-due');

      if (assignee) {
        assignee.addEventListener('change', function () {
          state.filters.assignee = assignee.value;
          render();
        });
      }
      if (q) {
        q.addEventListener('input', function () {
          state.filters.q = q.value;
          render();
        });
      }
      if (due) {
        due.addEventListener('change', function () {
          state.filters.due = due.value;
          render();
        });
      }
    }

    function bindDnD(meta) {
      if (!meta.can_move) return;

      var cards = root.querySelectorAll('.rk-card[draggable="true"]');
      for (var i = 0; i < cards.length; i++) {
        cards[i].addEventListener('dragstart', onDragStart);
        cards[i].addEventListener('dragend', onDragEnd);
      }

      var cells = root.querySelectorAll('.rk-cell');
      for (var j = 0; j < cells.length; j++) {
        cells[j].addEventListener('dragover', function (e) {
          e.preventDefault();
        });
        cells[j].addEventListener('drop', onDrop);
      }
    }

    function onDragStart(e) {
      var el = e.currentTarget;
      el.classList.add('rk-dragging');
      state.drag = {
        issueId: el.getAttribute('data-issue-id'),
        fromStatusId: el.getAttribute('data-status-id'),
        fromAssignedToId: el.getAttribute('data-assigned-to-id'),
      };
      e.dataTransfer.effectAllowed = 'move';
    }

    function onDragEnd(e) {
      e.currentTarget.classList.remove('rk-dragging');
    }

    function onDrop(e) {
      e.preventDefault();
      if (!state.drag) return;

      var cell = e.currentTarget;
      var toStatusId = cell.getAttribute('data-drop-status-id');
      var toLaneId = cell.getAttribute('data-drop-lane-id');
      var toAssignedToId = null;

      if (state.data.meta.lane_type === 'assignee') {
        if (toLaneId === 'unassigned') toAssignedToId = null;
        else if (toLaneId && toLaneId !== 'none') toAssignedToId = toLaneId;
      }

      moveIssue(state.drag.issueId, toStatusId, toAssignedToId);
      state.drag = null;
    }

    function moveIssue(issueId, toStatusId, toAssignedToId) {
      var moveUrl = dataUrl.replace(/\/data$/, '') + '/issues/' + issueId + '/move';

      window.jQuery
        .ajax({
          url: moveUrl,
          method: 'PATCH',
          dataType: 'json',
          headers: { 'X-CSRF-Token': csrfToken() },
          data: { status_id: toStatusId, assigned_to_id: toAssignedToId },
        })
        .done(function (res) {
          if (res && res.warning) alert(res.warning);
          fetchData();
        })
        .fail(function (xhr) {
          var msg = (xhr.responseJSON && xhr.responseJSON.message) || '移動に失敗しました';
          alert(msg);
          fetchData();
        });
    }

    function modalHtml() {
      return [
        "<div class='rk-modal-backdrop' id='rk-modal' aria-hidden='true'>",
        "<div class='rk-modal'>",
        "<h3>タスク追加</h3>",
        "<div class='rk-row'><label>件名</label><input id='rk-new-subject' type='text' /></div>",
        "<div class='rk-row'><label>トラッカー</label><select id='rk-new-tracker'></select></div>",
        "<div class='rk-row'><label>担当者</label><select id='rk-new-assignee'></select></div>",
        "<div class='rk-row'><label>優先度</label><select id='rk-new-priority'></select></div>",
        "<div class='rk-row'><label>開始日</label><input id='rk-new-start-date' type='date' /></div>",
        "<div class='rk-row'><label>期日</label><input id='rk-new-due' type='date' /></div>",
        "<div class='rk-row'><label>説明</label><textarea id='rk-new-desc' rows='4'></textarea></div>",
        "<div class='rk-error' id='rk-new-error' style='display:none;'></div>",
        "<div class='rk-actions'>",
        "<button type='button' class='button' id='rk-new-cancel'>キャンセル</button>",
        "<button type='button' class='button-positive' id='rk-new-save'>作成</button>",
        '</div>',
        '</div>',
        '</div>',
      ].join('');
    }

    function bindAddButtons(meta) {
      if (!meta.can_create) return;

      var openButtons = root.querySelectorAll('.rk-add-col, .rk-add-cell');
      for (var i = 0; i < openButtons.length; i++) {
        openButtons[i].addEventListener('click', function (e) {
          var btn = e.currentTarget;
          var statusId = btn.getAttribute('data-status-id');
          var laneId = btn.getAttribute('data-lane-id');
          openModal({ statusId: statusId, laneId: laneId });
        });
      }
    }

    function openModal(context) {
      var modal = document.getElementById('rk-modal');
      var subject = document.getElementById('rk-new-subject');
      var tracker = document.getElementById('rk-new-tracker');
      var assignee = document.getElementById('rk-new-assignee');
      var startDate = document.getElementById('rk-new-start-date');
      var due = document.getElementById('rk-new-due');
      var priority = document.getElementById('rk-new-priority');
      var desc = document.getElementById('rk-new-desc');
      var err = document.getElementById('rk-new-error');

      subject.value = '';
      startDate.value = '';
      due.value = '';
      desc.value = '';
      err.style.display = 'none';
      err.textContent = '';

      tracker.innerHTML = buildSelect(state.data.lists.trackers || [], (state.data.lists.trackers[0] || {}).id);
      assignee.innerHTML = buildSelect(state.data.lists.assignees || [], defaultAssigneeId(context));
      priority.innerHTML = buildSelect([{ id: '', name: '（未設定）' }].concat(state.data.lists.priorities || []), '');

      document.getElementById('rk-new-cancel').onclick = function () {
        closeModal();
      };
      document.getElementById('rk-new-save').onclick = function () {
        createIssue(context);
      };

      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
      subject.focus();

      function defaultAssigneeId(ctx) {
        if (state.data.meta.lane_type !== 'assignee') return '';
        if (!ctx || !ctx.laneId) return '';
        if (ctx.laneId === 'unassigned') return '';
        if (ctx.laneId === 'none') return '';
        return String(ctx.laneId);
      }
    }

    function closeModal() {
      var modal = document.getElementById('rk-modal');
      if (!modal) return;
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    }

    function createIssue(context) {
      var createUrl = dataUrl.replace(/\/data$/, '') + '/issues';
      var err = document.getElementById('rk-new-error');

      var payload = {
        subject: document.getElementById('rk-new-subject').value,
        tracker_id: document.getElementById('rk-new-tracker').value,
        assigned_to_id: document.getElementById('rk-new-assignee').value,
        start_date: document.getElementById('rk-new-start-date').value,
        due_date: document.getElementById('rk-new-due').value,
        priority_id: document.getElementById('rk-new-priority').value,
        description: document.getElementById('rk-new-desc').value,
        status_id: context.statusId,
      };

      window.jQuery
        .ajax({
          url: createUrl,
          method: 'POST',
          dataType: 'json',
          headers: { 'X-CSRF-Token': csrfToken() },
          data: payload,
        })
        .done(function () {
          closeModal();
          fetchData();
        })
        .fail(function (xhr) {
          var msg =
            (xhr.responseJSON &&
              (xhr.responseJSON.message || errorFromFieldErrors(xhr.responseJSON.field_errors) || errorsToText(xhr.responseJSON.field_errors))) ||
            '作成に失敗しました';
          err.textContent = msg;
          err.style.display = 'block';
        });

      function errorFromFieldErrors(fieldErrors) {
        if (!fieldErrors) return null;
        if (fieldErrors.subject && fieldErrors.subject.length) return fieldErrors.subject[0];
        return null;
      }

      function errorsToText(fieldErrors) {
        if (!fieldErrors) return null;
        var parts = [];
        for (var key in fieldErrors) {
          if (!Object.prototype.hasOwnProperty.call(fieldErrors, key)) continue;
          var messages = fieldErrors[key];
          if (!messages || !messages.length) continue;
          parts.push(key + ': ' + messages.join(', '));
        }
        return parts.length ? parts.join(' / ') : null;
      }
    }

    fetchData();
  }

  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('redmine-kanban-root');
    if (root) init(root);
  });
})();

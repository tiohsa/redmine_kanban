document.addEventListener('DOMContentLoaded', function() {
  if (!document.getElementById('gantt-container')) return;
  new GanttChart(projectId);
});

class GanttChart {
  constructor(projectId) {
    this.projectId = projectId;
    this.container = document.getElementById('gantt-container');
    this.sideHeader = document.getElementById('gantt-side-header');
    this.sideBody = document.getElementById('gantt-side-body');
    this.headerScroll = document.getElementById('gantt-header-scroll');
    this.header = document.getElementById('gantt-header');
    this.bodyScroll = document.getElementById('gantt-body-scroll');
    this.body = document.getElementById('gantt-body');
    this.svg = document.getElementById('gantt-lines');
    const { zoom, months } = this.parseRangeParams();
    this.zoom = zoom;
    this.rangeMonths = months;
    this.dayWidth = this.dayWidthForZoom(zoom);
    this.container.style.setProperty('--gantt-day-width', `${this.dayWidth}px`);
    this.rowHeight = 40;
    this.barHeight = 24;
    this.barTop = 8;
    this.sideWidth = 580;
    
    this.issues = [];
    this.relations = [];
    this.minDate = null;
    this.maxDate = null;
    
    this.dragState = null;
    this.connectState = null;
    window.ganttChart = this;
    this.init();
  }

  async init() {
    this.setupSVG();
    await this.fetchData();
    if (this.issues.length === 0) {
        this.body.innerHTML += '<div style="padding:20px;">No issues found.</div>';
        return;
    }
    this.calculateBounds();
    this.render();
    this.attachGlobalEvents();
    this.syncScroll();
    this.initResizer();
  }

  parseRangeParams() {
    const url = new URL(window.location.href);
    const zoom = parseInt(url.searchParams.get('zoom') || '2', 10);
    const months = parseInt(url.searchParams.get('months') || '3', 10);
    const clampedZoom = [1, 2, 4].includes(zoom) ? zoom : 2;
    const clampedMonths = [1, 3, 6].includes(months) ? months : 3;
    return { zoom: clampedZoom, months: clampedMonths };
  }

  dayWidthForZoom(zoom) {
    if (zoom === 4) return 48; // 日ビュー: 広め
    if (zoom === 2) return 32; // 週ビュー: 中間
    return 20; // 月ビュー: 細め
  }

  isoWeek(date) {
    const tmp = new Date(date);
    tmp.setHours(0, 0, 0, 0);
    tmp.setDate(tmp.getDate() + 4 - (tmp.getDay() || 7));
    const yearStart = new Date(tmp.getFullYear(), 0, 1);
    const weekNo = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
    return weekNo;
  }
  
  setupSVG() {
      // Add arrowhead marker
      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      marker.setAttribute('id', 'arrowhead');
      marker.setAttribute('markerWidth', '10');
      marker.setAttribute('markerHeight', '7');
      marker.setAttribute('refX', '10');
      marker.setAttribute('refY', '3.5');
      marker.setAttribute('orient', 'auto');
      
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute('points', '0 0, 10 3.5, 0 7');
      polygon.setAttribute('fill', '#9ca3af');
      
      marker.appendChild(polygon);
      defs.appendChild(marker);
      this.svg.appendChild(defs);
  }

  async fetchData() {
    const response = await fetch(`/projects/${this.projectId}/gantts/data`);
    const data = await response.json();
    this.issues = data.issues;
    this.relations = data.relations || [];
    
    // Parse dates
    this.issues.forEach(i => {
        i.start = i.start_date ? new Date(i.start_date) : new Date();
        i.due = i.due_date ? new Date(i.due_date) : new Date(i.start);
        i.start.setHours(0,0,0,0);
        i.due.setHours(0,0,0,0);
    });
  }

  calculateBounds() {
    if (this.issues.length === 0) return;
    let min = new Date(this.issues[0].start);
    let max = new Date(this.issues[0].due);

    this.issues.forEach(i => {
        if (i.start < min) min = new Date(i.start);
        if (i.due > max) max = new Date(i.due);
    });

    const start = new Date(min);
    start.setDate(1);
    const end = new Date(start);
    end.setMonth(end.getMonth() + this.rangeMonths);
    end.setDate(end.getDate() - 1);

    if (max > end) {
      end.setTime(max.getTime());
      end.setDate(end.getDate() + 7); // 少し余白
    }

    this.minDate = start;
    this.maxDate = end;
  }

  dateToPixels(date) {
    const diffTime = date - this.minDate;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays * this.dayWidth;
  }
  
  pixelsToDays(pixels) {
      return Math.round(pixels / this.dayWidth);
  }

  render() {
    this.renderSide();
    this.renderHeader();
    this.renderBody();
    this.renderConnections();
    this.renderProgressLightning();
  }

  renderSide() {
    const columns = [
      { key: 'subject', label: 'チケット', width: 180, render: (i) => `#${i.id} ${i.subject}` },
      { key: 'status', label: 'ステータス', width: 110, render: (i) => i.status },
      { key: 'assignee', label: '担当者', width: 130, render: (i) => i.assigned_to || '未割当' },
      { key: 'progress', label: '進捗', width: 80, render: (i) => `${i.done_ratio || 0}%` },
      { key: 'due', label: '期日', width: 80, render: (i) => i.due_date || '-' }
    ];

    this.sideWidth = columns.reduce((sum, col) => sum + col.width, 0);
    this.container.style.setProperty('--gantt-side-width', `${this.sideWidth}px`);
    this.sideHeader.innerHTML = '';
    this.sideBody.innerHTML = '';

    const headerRow = document.createElement('div');
    headerRow.className = 'gantt-side-header-row';
    columns.forEach(col => {
      const cell = document.createElement('div');
      cell.className = 'gantt-side-cell';
      cell.style.width = `${col.width}px`;
      cell.textContent = col.label;
      headerRow.appendChild(cell);
    });
    this.sideHeader.appendChild(headerRow);

    this.sideBody.style.minWidth = `${this.sideWidth}px`;
    this.sideBody.style.width = `${this.sideWidth}px`;
    this.sideBody.style.height = `${this.issues.length * this.rowHeight}px`;

    this.issues.forEach((issue) => {
      const row = document.createElement('div');
      row.className = 'gantt-side-row';
      row.style.height = `${this.rowHeight}px`;
      columns.forEach(col => {
        const cell = document.createElement('div');
        cell.className = 'gantt-side-cell';
        cell.style.width = `${col.width}px`;
        if (col.key === 'subject') {
          const link = document.createElement('a');
          link.href = `/issues/${issue.id}/edit`;
          link.target = '_blank';
          link.rel = 'noopener';
          link.textContent = col.render(issue);
          link.title = 'チケットを編集';
          cell.appendChild(link);
        } else {
          cell.textContent = col.render(issue);
        }
        row.appendChild(cell);
      });
      this.sideBody.appendChild(row);
    });
  }

  renderHeader() {
    const msPerDay = 1000 * 60 * 60 * 24;
    const daysCount = Math.round((this.maxDate - this.minDate) / msPerDay) + 1;
    const totalWidth = daysCount * this.dayWidth;

    const yearRow = document.createElement('div');
    yearRow.className = 'gantt-header-row gantt-years';
    const monthRow = document.createElement('div');
    monthRow.className = 'gantt-header-row gantt-months';
    const scaleRow = document.createElement('div');
    scaleRow.className = 'gantt-header-row gantt-scale';

    // 年
    {
      let cursor = new Date(this.minDate);
      while (cursor <= this.maxDate) {
        const endOfYear = new Date(cursor.getFullYear(), 11, 31);
        const segmentEnd = endOfYear < this.maxDate ? endOfYear : this.maxDate;
        const days = Math.round((segmentEnd - cursor) / msPerDay) + 1;
        const cell = document.createElement('div');
        cell.className = 'gantt-header-cell';
        cell.style.width = `${days * this.dayWidth}px`;
        cell.textContent = `${cursor.getFullYear()}年`;
        yearRow.appendChild(cell);
        cursor = new Date(segmentEnd);
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    // 月
    {
      let cursor = new Date(this.minDate);
      while (cursor <= this.maxDate) {
        const endOfMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
        const segmentEnd = endOfMonth < this.maxDate ? endOfMonth : this.maxDate;
        const days = Math.round((segmentEnd - cursor) / msPerDay) + 1;
        const cell = document.createElement('div');
        cell.className = 'gantt-header-cell';
        cell.style.width = `${days * this.dayWidth}px`;
        cell.textContent = `${cursor.getMonth() + 1}月`;
        monthRow.appendChild(cell);
        cursor = new Date(segmentEnd);
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    // 日/週/月
    if (this.zoom === 4) {
      let cursor = new Date(this.minDate);
      while (cursor <= this.maxDate) {
        const cell = document.createElement('div');
        cell.className = 'gantt-header-cell';
        cell.style.width = `${this.dayWidth}px`;
        cell.textContent = `${cursor.getDate()}`;
        scaleRow.appendChild(cell);
        cursor.setDate(cursor.getDate() + 1);
      }
    } else if (this.zoom === 2) {
      let cursor = new Date(this.minDate);
      // 週頭を月曜に揃える
      const day = cursor.getDay() || 7;
      cursor.setDate(cursor.getDate() - (day - 1));
      while (cursor <= this.maxDate) {
        const weekStart = new Date(cursor);
        const weekEnd = new Date(cursor);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const segmentEnd = weekEnd < this.maxDate ? weekEnd : this.maxDate;
        const days = Math.round((segmentEnd - cursor) / msPerDay) + 1;
        const cell = document.createElement('div');
        cell.className = 'gantt-header-cell';
        cell.style.width = `${days * this.dayWidth}px`;
        cell.textContent = `W${this.isoWeek(weekStart)}`;
        scaleRow.appendChild(cell);
        cursor.setDate(cursor.getDate() + 7);
      }
    } else {
      let cursor = new Date(this.minDate);
      while (cursor <= this.maxDate) {
        const endOfMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
        const segmentEnd = endOfMonth < this.maxDate ? endOfMonth : this.maxDate;
        const days = Math.round((segmentEnd - cursor) / msPerDay) + 1;
        const cell = document.createElement('div');
        cell.className = 'gantt-header-cell';
        cell.style.width = `${days * this.dayWidth}px`;
        cell.textContent = '';
        scaleRow.appendChild(cell);
        cursor = new Date(segmentEnd);
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    this.header.innerHTML = '';
    this.header.appendChild(yearRow);
    this.header.appendChild(monthRow);
    this.header.appendChild(scaleRow);

    this.header.style.width = `${totalWidth}px`;
    this.body.style.width = `${totalWidth}px`;
    this.svg.style.width = `${totalWidth}px`;
    this.svg.style.height = (this.issues.length * this.rowHeight) + 'px';
  }

  renderBody() {
    // Clear rows but keep SVG
    const bands = this.body.querySelector('.gantt-day-bands');
    if (bands) bands.remove();
    const rows = this.body.querySelectorAll('.gantt-row');
    rows.forEach(r => r.remove());

    this.renderDayBands();
    
    this.issues.forEach((issue, index) => {
        const row = document.createElement('div');
        row.className = 'gantt-row';
        row.dataset.index = index;
        
        const bar = document.createElement('div');
        bar.className = 'gantt-bar';
        bar.dataset.id = issue.id;
        bar.textContent = `#${issue.id} ${issue.subject}`;
        
        const left = this.dateToPixels(issue.start);
        const width = this.dateToPixels(issue.due) - left + this.dayWidth;
        
        bar.style.left = left + 'px';
        bar.style.width = width + 'px';
        
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'gantt-handle-resize';
        bar.appendChild(resizeHandle);
        
        const connectHandle = document.createElement('div');
        connectHandle.className = 'gantt-handle-connect';
        bar.appendChild(connectHandle);
        
        row.appendChild(bar);
        this.body.appendChild(row);
        
        bar.addEventListener('mousedown', (e) => this.handleMouseDown(e, issue));
    });
  }
  
  renderConnections() {
      // Clear existing lines (except defs)
      const lines = this.svg.querySelectorAll('path');
      lines.forEach(l => l.remove());
      
      this.relations.forEach(rel => {
          const fromIssue = this.issues.find(i => i.id == rel.from);
          const toIssue = this.issues.find(i => i.id == rel.to);
          
          if (fromIssue && toIssue) {
              const fromIdx = this.issues.indexOf(fromIssue);
              const toIdx = this.issues.indexOf(toIssue);
              
              const x1 = this.dateToPixels(fromIssue.due) + this.dayWidth;
              const y1 = (fromIdx * this.rowHeight) + this.barTop + (this.barHeight / 2);
              
              const x2 = this.dateToPixels(toIssue.start);
              const y2 = (toIdx * this.rowHeight) + this.barTop + (this.barHeight / 2);
              
              this.drawPath(x1, y1, x2, y2);
          }
      });
  }
  
  drawPath(x1, y1, x2, y2) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'gantt-connection');
      
      let d = '';
      const gap = 15;
      
      if (x2 > x1 + gap) {
          // Simple 3-segment
          // M x1 y1 -> L x1+gap y1 -> L x1+gap y2 -> L x2 y2
          const midX = x1 + gap;
          d = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
      } else {
          // 5-segment loop around
          // M x1 y1 -> L x1+gap y1 -> L x1+gap y_mid -> L x2-gap y_mid -> L x2-gap y2 -> L x2 y2
          const midX1 = x1 + gap;
          const midX2 = x2 - gap;
          const midY = y1 + (this.rowHeight / 2) + 5; // Go down a bit
          
          d = `M ${x1} ${y1} L ${midX1} ${y1} L ${midX1} ${midY} L ${midX2} ${midY} L ${midX2} ${y2} L ${x2} ${y2}`;
      }
      
      path.setAttribute('d', d);
      this.svg.appendChild(path);
  }

  handleMouseDown(e, issue) {
    if (e.target.classList.contains('gantt-handle-resize')) {
        e.stopPropagation();
        const bar = e.target.closest('.gantt-bar');
        this.dragState = {
            type: 'resize',
            issue: issue,
            startX: e.clientX,
            initialWidth: bar.offsetWidth,
            element: bar
        };
    } else if (e.target.classList.contains('gantt-handle-connect')) {
        e.stopPropagation();
        this.connectState = {
            sourceId: issue.id,
            startX: e.clientX,
            startY: e.clientY
        };
    } else {
        const bar = e.target.closest('.gantt-bar');
        this.dragState = {
            type: 'move',
            issue: issue,
            startX: e.clientX,
            initialLeft: parseFloat(bar.style.left),
            element: bar
        };
    }
  }

  attachGlobalEvents() {
    document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    document.addEventListener('mouseup', (e) => this.handleMouseUp(e));
  }

  syncScroll() {
    if (!this.bodyScroll || !this.headerScroll) return;
    this.bodyScroll.addEventListener('scroll', () => {
      this.headerScroll.scrollLeft = this.bodyScroll.scrollLeft;
    });
  }

  handleMouseMove(e) {
    if (this.dragState) {
        const dx = e.clientX - this.dragState.startX;
        
        if (this.dragState.type === 'move') {
            this.dragState.element.style.left = (this.dragState.initialLeft + dx) + 'px';
        } else if (this.dragState.type === 'resize') {
            this.dragState.element.style.width = (this.dragState.initialWidth + dx) + 'px';
        }
        // Re-render connections while dragging could be expensive, maybe just on end
        // But for smoothness:
        // this.renderConnections(); // Requires updating issue data in real-time which we aren't doing yet
    }
  }

  async handleMouseUp(e) {
    if (this.dragState) {
        const dx = e.clientX - this.dragState.startX;
        const daysDiff = this.pixelsToDays(dx);
        
        if (daysDiff !== 0) {
            const issue = this.dragState.issue;
            let newStart = new Date(issue.start);
            let newDue = new Date(issue.due);
            
            if (this.dragState.type === 'move') {
                newStart.setDate(newStart.getDate() + daysDiff);
                newDue.setDate(newDue.getDate() + daysDiff);
            } else if (this.dragState.type === 'resize') {
                newDue.setDate(newDue.getDate() + daysDiff);
            }
            
            issue.start = newStart;
            issue.due = newDue;
            
            await this.updateIssue(issue.id, newStart, newDue);
            this.render(); 
        } else {
             this.render();
        }
        
        this.dragState = null;
    }
    
    if (this.connectState) {
        const targetBar = e.target.closest('.gantt-bar');
        if (targetBar) {
            const targetId = targetBar.dataset.id;
            if (targetId && targetId != this.connectState.sourceId) {
                if (confirm(`Link issue #${this.connectState.sourceId} to #${targetId}?`)) {
                    await this.createRelation(this.connectState.sourceId, targetId);
                    // Refresh data to get the new relation ID and verify
                    await this.fetchData();
                    this.render();
                }
            }
        }
        this.connectState = null;
    }
  }

  async updateIssue(id, start, due) {
      const formatDate = (d) => d.toISOString().split('T')[0];
      try {
          const response = await fetch(`/gantts/${id}/update_issue`, {
              method: 'PUT',
              headers: {
                  'Content-Type': 'application/json',
                  'X-CSRF-Token': csrfToken
              },
              body: JSON.stringify({
                  start_date: formatDate(start),
                  due_date: formatDate(due)
              })
          });
          if (!response.ok) throw new Error('Update failed');
      } catch (err) {
          alert('Failed to update issue: ' + err.message);
          await this.fetchData();
          this.render();
      }
  }

  async createRelation(fromId, toId) {
      try {
          const response = await fetch(`/gantts/create_relation`, {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
                  'X-CSRF-Token': csrfToken
              },
              body: JSON.stringify({
                  issue_from_id: fromId,
                  issue_to_id: toId
              })
          });
          if (!response.ok) {
              const data = await response.json();
              throw new Error(data.errors ? data.errors.join(', ') : 'Unknown error');
          }
      } catch (err) {
          alert('Failed to create relation: ' + err.message);
      }
  }

  renderDayBands() {
    const bands = document.createElement('div');
    bands.className = 'gantt-day-bands';
    const totalHeight = this.issues.length * this.rowHeight;
    bands.style.height = `${totalHeight}px`;

    let cursor = new Date(this.minDate);
    let left = 0;
    while (cursor <= this.maxDate) {
      const band = document.createElement('div');
      band.className = 'gantt-day-band';
      band.style.left = `${left}px`;
      band.style.width = `${this.dayWidth}px`;

      const wday = cursor.getDay();
      if (wday === 0) {
        band.classList.add('sun');
      } else if (wday === 6) {
        band.classList.add('sat');
      }

      bands.appendChild(band);
      left += this.dayWidth;
      cursor.setDate(cursor.getDate() + 1);
    }

    this.body.appendChild(bands);
  }

  renderProgressLightning() {
    if (!this.svg || this.issues.length === 0) return;

    this.svg.querySelectorAll('.gantt-progress-line, .gantt-progress-baseline, .gantt-progress-point').forEach(el => el.remove());

    const msPerDay = 1000 * 60 * 60 * 24;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayX = this.dateToPixels(today);

    const actualPoints = [];

    this.issues.forEach((issue, index) => {
      const start = new Date(issue.start);
      const due = new Date(issue.due);
      const durationDays = Math.max(1, Math.round((due - start) / msPerDay));
      const actualRatio = Math.min(1, Math.max(0, (issue.done_ratio || 0) / 100));

      // 対象: 期日が今日以降、または未完了で期日超過のもの
      const isActive = (today <= due) || (actualRatio < 1);
      if (!isActive) return;

      const actualDate = new Date(start);
      actualDate.setDate(start.getDate() + Math.round(durationDays * actualRatio));

      const y = (index * this.rowHeight) + this.barTop + (this.barHeight / 2);
      const actualX = this.dateToPixels(actualDate);

      // 完了済みは基準線上に置く
      const pointX = actualRatio >= 1 ? todayX : actualX;

      actualPoints.push({
        x: pointX,
        y,
        status: pointX < todayX ? 'behind' : pointX > todayX ? 'ahead' : 'ontime'
      });
    });

    // 基準線（今日）
    if (today >= this.minDate && today <= this.maxDate) {
      const baseline = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      baseline.setAttribute('class', 'gantt-progress-baseline');
      baseline.setAttribute('x1', todayX);
      baseline.setAttribute('x2', todayX);
      baseline.setAttribute('y1', 0);
      baseline.setAttribute('y2', this.issues.length * this.rowHeight);
      this.svg.appendChild(baseline);
    }

    const buildPath = (points) => {
      if (!points.length) return '';
      return points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    };

    const actualPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    actualPath.setAttribute('class', 'gantt-progress-line');
    actualPath.setAttribute('d', buildPath(actualPoints));
    this.svg.appendChild(actualPath);

    actualPoints.forEach((p) => {
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('class', `gantt-progress-point ${p.status}`);
      dot.setAttribute('cx', p.x);
      dot.setAttribute('cy', p.y);
      dot.setAttribute('r', 4);
      this.svg.appendChild(dot);
    });
  }

  scrollToToday() {
    if (!this.bodyScroll) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (today < this.minDate) {
      this.bodyScroll.scrollLeft = 0;
      return;
    }
    if (today > this.maxDate) {
      this.bodyScroll.scrollLeft = this.body.scrollWidth;
      return;
    }
    const x = this.dateToPixels(today);
    const offset = Math.max(0, x - (this.bodyScroll.clientWidth / 2));
    this.bodyScroll.scrollLeft = offset;
  }

  initResizer() {
    const handle = document.getElementById('gantt-resizer-header');
    if (!handle) return;
    let startX = 0;
    let startWidth = this.sideWidth;

    const onMove = (e) => {
      const delta = e.clientX - startX;
      const next = Math.min(Math.max(startWidth + delta, 220), 900);
      this.sideWidth = next;
      this.container.style.setProperty('--gantt-side-width', `${next}px`);
      this.renderSide();
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    handle.addEventListener('mousedown', (e) => {
      startX = e.clientX;
      startWidth = this.sideWidth;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
}

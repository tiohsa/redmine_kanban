$(function() {
  // Only run if we are on the Gantt page
  if ($('#gantt_area').length === 0) {
    console.log("Gantt area not found, skipping drag drop init.");
    return;
  }

  console.log("Gantt Drag & Drop Plugin Loaded");

  if (typeof $.fn.draggable === 'undefined') {
    console.error("jQuery UI Draggable not loaded!");
    return;
  }

  function getPixelsPerDay() {
    var headers = $('.gantt_hdr');
    if (headers.length === 0) return 24; 

    var maxTop = 0;
    headers.each(function() {
      var t = parseInt($(this).css('top'), 10);
      if (t > maxTop) maxTop = t;
    });

    var bottomHeaders = headers.filter(function() {
      return parseInt($(this).css('top'), 10) == maxTop;
    });

    if (bottomHeaders.length > 0) {
      return $(bottomHeaders[0]).outerWidth();
    }
    return 24;
  }

  function getIssueId(element) {
    var idAttr = $(element).attr('id');
    if (idAttr) {
      // Matches task-todo-issue-123
      var match = idAttr.match(/issue-(\d+)/);
      if (match) return match[1];
    }
    return null;
  }

  function formatDate(date) {
    var d = new Date(date),
        month = '' + (d.getMonth() + 1),
        day = '' + d.getDate(),
        year = d.getFullYear();

    if (month.length < 2) month = '0' + month;
    if (day.length < 2) day = '0' + day;

    return [year, month, day].join('-');
  }

  function updateIssue(issueId, dayShift, durationChange) {
    if (!issueId) return;

    // Fetch current issue data to get start/due dates
    $.ajax({
      url: '/issues/' + issueId + '.json',
      type: 'GET',
      success: function(data) {
        var issue = data.issue;
        if (!issue.start_date || !issue.due_date) {
          alert("Cannot update issue without start or due date.");
          return;
        }

        var start = new Date(issue.start_date);
        var due = new Date(issue.due_date);

        // Calculate new dates
        var newStart = new Date(start);
        newStart.setDate(start.getDate() + dayShift);
        
        var newDue = new Date(due);
        newDue.setDate(due.getDate() + dayShift + durationChange);

        var payload = {
          issue: {
            start_date: formatDate(newStart),
            due_date: formatDate(newDue)
          }
        };

        var csrfToken = $('meta[name="csrf-token"]').attr('content');
        console.log("CSRF Token:", csrfToken);

        $.ajax({
          url: '/issues/' + issueId + '.json',
          type: 'PUT',
          contentType: 'application/json',
          data: JSON.stringify(payload),
          xhrFields: {
            withCredentials: true
          },
          headers: {
            'X-CSRF-Token': csrfToken,
            'X-Redmine-API-Key': window.redmineApiKey
          },
          success: function() {
            console.log('Issue ' + issueId + ' updated.');
            // Reload to refresh the Gantt chart
            location.reload();
          },
          error: function(xhr) {
            console.error('Failed to update issue', xhr);
            if (xhr.status === 403) {
               alert('Permission denied. Please ensure you are logged in and have permission to edit issues.');
            } else {
               alert('Failed to update issue. Status: ' + xhr.status);
            }
          }
        });
      }
    });
  }
  
  var pxPerDay = getPixelsPerDay();
  console.log("Pixels per day:", pxPerDay);

  // Target only the todo bars (the main background bars)
  var tasks = $('.task_todo');
  console.log("Found " + tasks.length + " draggable tasks.");

  tasks.each(function() {
    var $this = $(this);
    
    if (!getIssueId($this)) return;

    // Draggable
    $this.draggable({
      axis: 'x',
      containment: '#gantt_area',
      grid: [pxPerDay, 1], 
      start: function(event, ui) {
        $this.data('start-left', ui.position.left);
      },
      stop: function(event, ui) {
        var dx = ui.position.left - $this.data('start-left');
        var days = Math.round(dx / pxPerDay);
        
        if (days !== 0) {
          updateIssue(getIssueId($this), days, 0);
        }
      }
    });

    // Resizable
    $this.resizable({
      handles: 'e, w',
      grid: [pxPerDay, 1],
      start: function(event, ui) {
        $this.data('start-left', ui.position.left);
        $this.data('start-width', ui.size.width);
      },
      stop: function(event, ui) {
        var dWidth = ui.size.width - $this.data('start-width');
        var dLeft = ui.position.left - $this.data('start-left');
        
        var dayShift = Math.round(dLeft / pxPerDay);
        var durationChange = Math.round(dWidth / pxPerDay); // This is change in width (duration)
        // Note: if I drag left handle left, width increases, left decreases.
        // dayShift will be negative. durationChange will be positive.
        // New Start = Start + dayShift.
        // New End = New Start + New Duration.
        // Logic in updateIssue:
        // New Due = Due + dayShift + durationChange.
        // If I drag left handle left by 1 day:
        // dayShift = -1. durationChange = +1.
        // New Start = Start - 1.
        // New Due = Due - 1 + 1 = Due. (Correct, end date doesn't change)
        
        // If I drag right handle right by 1 day:
        // dayShift = 0. durationChange = +1.
        // New Start = Start.
        // New Due = Due + 0 + 1 = Due + 1. (Correct)
        
        if (dayShift !== 0 || durationChange !== 0) {
          updateIssue(getIssueId($this), dayShift, durationChange);
        }
      }
    });
  });
});

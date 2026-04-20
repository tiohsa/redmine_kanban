import React, { useEffect, useRef } from 'react';

type Props = {
  labels: Record<string, string>;
  onClose: () => void;
};

export function HelpDialog({ labels, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleBackdropClick = (event: React.MouseEvent) => {
    if (dialogRef.current && !dialogRef.current.contains(event.target as Node)) {
      onClose();
    }
  };

  const IconRow = ({ icon, text }: { icon: string; text: string }) => (
    <div className="rk-help-icon-row">
      <span className="rk-icon rk-help-icon">{icon}</span>
      <span className="rk-help-icon-text">{text}</span>
    </div>
  );

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="rk-help-section">
      <h3 className="rk-help-section-title">{title}</h3>
      {children}
    </div>
  );

  const SubSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="rk-help-subsection">
      <h4 className="rk-help-subsection-title">{title}</h4>
      <div className="rk-help-subsection-content">{children}</div>
    </div>
  );

  return (
    <div className="rk-modal-backdrop rk-help-backdrop" onClick={handleBackdropClick}>
      <div ref={dialogRef} className="rk-modal rk-help-dialog">
        <div className="rk-help-header">
          <div className="rk-help-title-wrap">
            <span className="rk-icon" style={{ fontSize: '24px' }}>help_outline</span>
            <h3>{labels.help}</h3>
          </div>
          <button type="button" className="rk-icon-btn rk-help-close-x" onClick={onClose} title={labels.close} aria-label={labels.close}>
            <span className="rk-icon">close</span>
          </button>
        </div>

        <div className="rk-help-content">
          <Section title={labels.help_chapter1_title}>
            <p className="rk-help-desc">{labels.help_chapter1_desc}</p>
            <div className="rk-help-icon-grid">
              <IconRow icon="add" text={labels.help_add} />
              <IconRow icon="filter_list" text={labels.help_filter} />
              <IconRow icon="person" text={labels.help_assignee} />
              <IconRow icon="folder" text={labels.help_project} />
              <IconRow icon="fact_check" text={labels.help_status} />
              <IconRow icon="priority_high" text={labels.help_priority} />
              <IconRow icon="calendar_month" text={labels.help_due} />
              <IconRow icon="sort" text={labels.help_sort} />
              <IconRow icon="view_stream" text={labels.help_priority_lane} />
              <IconRow icon="schedule" text={labels.help_time_entry} />
              <IconRow icon="folder_shared" text={labels.help_viewable_projects} />
              <IconRow icon="fit_screen" text={labels.help_fit_mode} />
              <IconRow icon="check_box" text={labels.help_show_subtasks} />
              <IconRow icon="fullscreen" text={labels.help_fullscreen} />
              <IconRow icon="vertical_align_top" text={labels.help_scroll_top} />
              <IconRow icon="format_size" text={labels.help_font_size} />
            </div>
          </Section>

          <Section title={labels.help_chapter2_title}>
            <SubSection title={labels.help_drag_drop_title}>
              <p>{labels.help_drag_drop_desc}</p>
            </SubSection>
            <SubSection title={labels.help_edit_title}>
              <p>{labels.help_edit_desc}</p>
            </SubSection>
            <SubSection title={labels.help_quick_edit_title}>
              <p>{labels.help_quick_edit_desc}</p>
            </SubSection>
            <SubSection title={labels.help_subtask_title}>
              <p>{labels.help_subtask_desc}</p>
            </SubSection>
          </Section>
        </div>

        <div className="rk-help-footer">
          <button type="button" className="rk-btn rk-help-close-footer" onClick={() => onClose()}>
            {labels.close}
          </button>
        </div>
      </div>
    </div>
  );
}

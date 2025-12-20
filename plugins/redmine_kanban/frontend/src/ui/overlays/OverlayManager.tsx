import React, { useState, useEffect } from 'react';
import { BoardStore } from '../../store/BoardStore';
import { Card } from '../../domain/model';

interface OverlayManagerProps {
  store: BoardStore;
  activeCardId: number | null;
  onClose: () => void;
}

export const OverlayManager: React.FC<OverlayManagerProps> = ({ store, activeCardId, onClose }) => {
  const [card, setCard] = useState<Card | null>(null);
  const [formData, setFormData] = useState({ subject: '', description: '' });

  useEffect(() => {
    if (activeCardId !== null) {
      const state = store.getState();
      const found = state.entities.cards[activeCardId];
      if (found) {
        setCard(found);
        setFormData({ subject: found.subject, description: found.description });
      }
    } else {
      setCard(null);
    }
  }, [activeCardId, store]);

  if (!card) return null;

  const handleSave = () => {
    store.execute({
      type: 'UPDATE_CARD',
      timestamp: Date.now(),
      payload: {
        cardId: card.id,
        changes: {
          subject: formData.subject,
          description: formData.description
        }
      }
    });
    onClose();
  };

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1000
    }} onClick={onClose}>
      <div
        style={{
          backgroundColor: 'white',
          padding: '20px',
          borderRadius: '8px',
          minWidth: '400px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
        }}
        onClick={e => e.stopPropagation()}
      >
        <h2>Edit Card #{card.id}</h2>
        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', fontWeight: 'bold' }}>Subject</label>
          <input
            type="text"
            value={formData.subject}
            onChange={e => setFormData({ ...formData, subject: e.target.value })}
            style={{ width: '100%', padding: '8px', marginTop: '4px' }}
          />
        </div>
        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', fontWeight: 'bold' }}>Description</label>
          <textarea
            value={formData.description}
            onChange={e => setFormData({ ...formData, description: e.target.value })}
            style={{ width: '100%', padding: '8px', marginTop: '4px', minHeight: '100px' }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button onClick={onClose} style={{ padding: '8px 16px' }}>Cancel</button>
          <button onClick={handleSave} style={{ padding: '8px 16px', backgroundColor: '#0052cc', color: 'white', border: 'none', borderRadius: '4px' }}>Save</button>
        </div>
      </div>
    </div>
  );
};

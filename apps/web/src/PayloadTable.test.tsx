import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import PayloadTable from './PayloadTable';

describe('archived field table', () => {
  it('keeps zero, null and empty collections and exposes every sample through pagination', () => {
    render(<PayloadTable payload={{heartRate: 0, sleepEvaluation: null, empty: [], samples: Array.from({length: 110},(_,i)=>({offsetMillis:i}))}}/>);
    expect(screen.getByText('heartRate')).toBeVisible();
    expect(screen.getByText('bpm')).toBeVisible();
    expect(screen.getByText('Nicht vorhanden')).toBeVisible();
    expect(screen.getByText('[]')).toBeVisible();
    expect(screen.queryByText('samples[109].offsetMillis')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Nächste Felder'}));
    expect(screen.getByText('samples[109].offsetMillis')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Messfelder durchsuchen'),{target:{value:'samples[2].offsetMillis'}});
    expect(screen.getByText('samples[2].offsetMillis')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Messfelder durchsuchen'),{target:{value:'bpm'}});
    expect(screen.getByText('heartRate')).toBeVisible();
  });
});

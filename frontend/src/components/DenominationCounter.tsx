'use client';

import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Coins, Banknote } from 'lucide-react';

export interface DenominationState {
  notes_5000: number | string;
  notes_2000: number | string;
  notes_1000: number | string;
  notes_500: number | string;
  notes_100: number | string;
  notes_50: number | string;
  notes_20: number | string;
  notes_10: number | string;
  coins_total: number | string;
}

const DENOM_CONFIG = [
  { key: 'notes_5000', value: 5000, label: 'Rs. 5,000 Note' },
  { key: 'notes_2000', value: 2000, label: 'Rs. 2,000 Note' },
  { key: 'notes_1000', value: 1000, label: 'Rs. 1,000 Note' },
  { key: 'notes_500',  value: 500,  label: 'Rs. 500 Note' },
  { key: 'notes_100',  value: 100,  label: 'Rs. 100 Note' },
  { key: 'notes_50',   value: 50,   label: 'Rs. 50 Note' },
  { key: 'notes_20',   value: 20,   label: 'Rs. 20 Note' },
  { key: 'notes_10',   value: 10,   label: 'Rs. 10 Note' },
] as const;

interface Props {
  denominations: DenominationState;
  onChange: (updated: DenominationState) => void;
  expectedAmount?: number;
  readOnly?: boolean;
}

export function DenominationCounter({ denominations, onChange, expectedAmount, readOnly = false }: Props) {
  const handleChange = (key: keyof DenominationState, val: string) => {
    if (readOnly) return;
    const clean = val === '' ? '' : Math.max(0, parseInt(val, 10) || 0);
    onChange({
      ...denominations,
      [key]: clean
    });
  };

  const handleCoinsChange = (val: string) => {
    if (readOnly) return;
    const clean = val === '' ? '' : Math.max(0, parseFloat(val) || 0);
    onChange({
      ...denominations,
      coins_total: clean
    });
  };

  // Compute live total
  const noteSum = DENOM_CONFIG.reduce((acc, curr) => {
    const qty = Number(denominations[curr.key as keyof DenominationState]) || 0;
    return acc + qty * curr.value;
  }, 0);
  const coins = Number(denominations.coins_total) || 0;
  const grandTotal = noteSum + coins;
  const variance = expectedAmount !== undefined ? Number((grandTotal - expectedAmount).toFixed(2)) : null;

  return (
    <div className="space-y-4 bg-slate-50 dark:bg-slate-900/60 p-5 rounded-2xl border border-slate-200 dark:border-slate-800">
      <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <Banknote className="w-5 h-5 text-emerald-600" />
          <h4 className="text-sm font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
            Physical Currency Denominations (LKR)
          </h4>
        </div>
        <div className="text-right">
          <span className="text-xs font-semibold text-slate-500 block">Total Counted</span>
          <span className="text-lg font-black text-emerald-600 dark:text-emerald-400">
            Rs. {grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {DENOM_CONFIG.map(({ key, value, label }) => {
          const qty = denominations[key as keyof DenominationState];
          const subtotal = (Number(qty) || 0) * value;

          return (
            <div key={key} className="bg-white dark:bg-slate-800/80 p-3 rounded-xl border border-slate-200/80 dark:border-slate-700/60 shadow-xs">
              <div className="flex justify-between items-center mb-1.5">
                <Label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  {label}
                </Label>
                <span className="text-[10px] font-mono text-slate-400">
                  Rs. {subtotal.toLocaleString()}
                </span>
              </div>
              <Input
                type="number"
                min="0"
                step="1"
                placeholder="0"
                value={qty ?? ''}
                disabled={readOnly}
                onChange={(e) => handleChange(key as keyof DenominationState, e.target.value)}
                className="h-9 font-bold text-sm text-right focus-visible:ring-emerald-500"
              />
            </div>
          );
        })}

        {/* Coins Total */}
        <div className="bg-white dark:bg-slate-800/80 p-3 rounded-xl border border-slate-200/80 dark:border-slate-700/60 shadow-xs">
          <div className="flex justify-between items-center mb-1.5">
            <Label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
              <Coins className="w-3 h-3 text-amber-500" /> Coins Total
            </Label>
            <span className="text-[10px] font-mono text-slate-400">
              Rs. {coins.toLocaleString()}
            </span>
          </div>
          <Input
            type="number"
            min="0"
            step="0.50"
            placeholder="0.00"
            value={denominations.coins_total ?? ''}
            disabled={readOnly}
            onChange={(e) => handleCoinsChange(e.target.value)}
            className="h-9 font-bold text-sm text-right focus-visible:ring-emerald-500"
          />
        </div>
      </div>

      {expectedAmount !== undefined && variance !== null && (
        <div className={`flex items-center justify-between p-3 rounded-xl text-xs font-bold ${
          Math.abs(variance) < 0.01 
            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300' 
            : 'bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/30 dark:text-rose-300'
        }`}>
          <span>Expected: Rs. {expectedAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
          <span>
            {Math.abs(variance) < 0.01 
              ? '✓ Balanced (Zero Variance)' 
              : `Variance: ${variance > 0 ? '+' : ''}Rs. ${variance.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${variance > 0 ? 'Surplus' : 'Shortage'})`
            }
          </span>
        </div>
      )}
    </div>
  );
}

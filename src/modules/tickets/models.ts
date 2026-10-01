import { Schema, model } from 'mongoose';

export const BUTTON_STYLES = ['primary', 'secondary', 'success', 'danger'] as const;
export type ButtonStyleName = (typeof BUTTON_STYLES)[number];

export interface Question {
  label: string;
  placeholder: string | null;
  long: boolean;
  required: boolean;
}

export interface TicketCategory {
  id: string;
  label: string;
  description: string | null;
  emoji: string | null;
  style: ButtonStyleName;
  /** Roles that can see and handle these tickets, on top of the server's support roles. */
  staffRoles: string[];
  /** Overrides the server's ticket category for this kind of ticket. */
  parentId: string | null;
  questions: Question[];
  welcome: string | null;
}

export interface PanelDoc {
  guildId: string;
  panelId: number;
  title: string;
  description: string;
  kind: 'buttons' | 'select';
  channelId: string | null;
  messageId: string | null;
  categories: TicketCategory[];
}

const questionSchema = new Schema<Question>(
  { label: String, placeholder: { type: String, default: null }, long: Boolean, required: Boolean },
  { _id: false },
);

const categorySchema = new Schema<TicketCategory>(
  {
    id: { type: String, required: true },
    label: { type: String, required: true },
    description: { type: String, default: null },
    emoji: { type: String, default: null },
    style: { type: String, enum: BUTTON_STYLES, default: 'primary' },
    staffRoles: { type: [String], default: [] },
    parentId: { type: String, default: null },
    questions: { type: [questionSchema], default: [] },
    welcome: { type: String, default: null },
  },
  { _id: false },
);

const panelSchema = new Schema<PanelDoc>(
  {
    guildId: { type: String, required: true },
    panelId: { type: Number, required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    kind: { type: String, enum: ['buttons', 'select'], default: 'buttons' },
    channelId: { type: String, default: null },
    messageId: { type: String, default: null },
    categories: { type: [categorySchema], default: [] },
  },
  { timestamps: true },
);
panelSchema.index({ guildId: 1, panelId: 1 }, { unique: true });

export const PanelModel = model<PanelDoc>('TicketPanel', panelSchema);

export interface TicketDoc {
  guildId: string;
  ticketId: number;
  kind: 'ticket' | 'modmail';
  channelId: string;
  ownerId: string;
  panelId: number | null;
  categoryId: string | null;
  categoryLabel: string | null;
  status: 'open' | 'closed';
  claimedBy: string | null;
  locked: boolean;
  answers: { question: string; answer: string }[];
  /** The bot's opening message with the claim/close/lock buttons. */
  controlMessageId: string | null;
  lastActivityAt: Date;
  reminderSentAt: Date | null;
  closedAt: Date | null;
  closedBy: string | null;
  closeReason: string | null;
  transcriptUrl: string | null;
  createdAt: Date;
}

const ticketSchema = new Schema<TicketDoc>(
  {
    guildId: { type: String, required: true },
    ticketId: { type: Number, required: true },
    kind: { type: String, enum: ['ticket', 'modmail'], default: 'ticket' },
    channelId: { type: String, required: true },
    ownerId: { type: String, required: true },
    panelId: { type: Number, default: null },
    categoryId: { type: String, default: null },
    categoryLabel: { type: String, default: null },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    claimedBy: { type: String, default: null },
    locked: { type: Boolean, default: false },
    answers: { type: [{ question: String, answer: String, _id: false }], default: [] },
    controlMessageId: { type: String, default: null },
    lastActivityAt: { type: Date, default: () => new Date() },
    reminderSentAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    closedBy: { type: String, default: null },
    closeReason: { type: String, default: null },
    transcriptUrl: { type: String, default: null },
  },
  { timestamps: true },
);
ticketSchema.index({ guildId: 1, ticketId: 1 }, { unique: true });
ticketSchema.index({ channelId: 1 }, { unique: true });
ticketSchema.index({ guildId: 1, ownerId: 1, status: 1 });
ticketSchema.index({ status: 1, lastActivityAt: 1 });

export const TicketModel = model<TicketDoc>('Ticket', ticketSchema);

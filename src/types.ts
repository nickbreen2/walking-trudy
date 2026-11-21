// Minimal subset of the Telegram Bot API types that Corgi Relay delivers.
// Relay only sends `message`, `edited_message` and `callback_query` updates.

export interface User {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface Chat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
}

export interface Message {
  message_id: number;
  message_thread_id?: number;
  is_topic_message?: boolean;
  from?: User;
  chat: Chat;
  date: number;
  text?: string;
  reply_to_message?: Message;
}

export interface CallbackQuery {
  id: string;
  from: User;
  message?: Message;
  data?: string;
}

export interface Update {
  update_id: number;
  message?: Message;
  edited_message?: Message;
  callback_query?: CallbackQuery;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

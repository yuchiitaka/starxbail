// xmes.d.ts
import { proto } from '../../WAProto';
import { WAMessage, WAMessageContent, WAUrlInfo } from '../Types';

declare module '../Types' {
    interface WASocket {
        xmes: (options: XMesOptions) => Promise<WAMessage>;
    }
}

// Button Types
export type ButtonType = 
    | 'cta_reply' 
    | 'cta_url' 
    | 'cta_copy' 
    | 'cta_call' 
    | 'single_select';

export interface Button {
    /** Type of button */
    type: ButtonType;
    /** Button title/text */
    title: string;
    /** Button ID (optional) */
    id?: string;
    /** URL for cta_url type */
    url?: string;
    /** Phone number for cta_call type */
    phoneNumber?: string;
    /** Text to copy for cta_copy type */
    copyText?: string;
    /** Sections for single_select type */
    sections?: Section[];
    /** Custom button parameters in JSON format */
    buttonParamsJson?: string;
}

export interface Section {
    /** Section title */
    title: string;
    /** List of rows in section */
    rows: Row[];
}

export interface Row {
    /** Row ID */
    id: string;
    /** Row title */
    title: string;
    /** Row description (optional) */
    description?: string;
}

// Location Types
export interface LocationMessage {
    /** Latitude in degrees */
    latitude: number;
    /** Longitude in degrees */
    longitude: number;
    /** Location name */
    name?: string;
    /** Address */
    address?: string;
    /** Caption text */
    caption?: string;
    /** Array of buttons */
    buttons?: Button[];
    /** JPEG thumbnail (buffer or url) */
    thumbnail?: Buffer | { url: string };
}

// Payment Types
export interface PaymentMethod {
    /** Payment method ID */
    id: string;
    /** Payment method name */
    name: string;
    /** Payment description */
    description?: string;
    /** Amount in smallest currency unit */
    amount: number;
    /** Currency code (default: "IDR") */
    currency?: string;
    /** Logo/image for payment method */
    logo?: Buffer | { url: string };
    /** Is this payment recommended? */
    isRecommended?: boolean;
}

export interface PaymentListMessage {
    /** Payment list title */
    title: string;
    /** Payment list description */
    description?: string;
    /** Currency code (default: "IDR") */
    currency?: string;
    /** List of payment methods */
    payments: PaymentMethod[];
    /** Array of buttons (only cta_url and single_select allowed) */
    buttons?: Button[];
}

// Interactive Message Types
export interface InteractiveMessage {
    /** Message title */
    title?: string;
    /** Message footer */
    footer?: string;
    /** Thumbnail URL or buffer */
    thumbnail?: string | Buffer;
    /** Image content */
    image?: Buffer | { url: string };
    /** Video content */
    video?: Buffer | { url: string };
    /** Document content */
    document?: Buffer | { url: string };
    /** MIME type for document */
    mimetype?: string;
    /** File name for document */
    fileName?: string;
    /** JPEG thumbnail for document */
    jpegThumbnail?: Buffer | { url: string };
    /** Context info */
    contextInfo?: any;
    /** External ad reply */
    externalAdReply?: any;
    /** Array of buttons */
    buttons?: Button[];
    /** Native flow message */
    nativeFlowMessage?: any;
}

// Product Message Types
export interface ProductMessage {
    /** Product title */
    title: string;
    /** Product description */
    description: string;
    /** Product thumbnail */
    thumbnail: Buffer | { url: string };
    /** Product ID */
    productId: string;
    /** Retailer ID */
    retailerId: string;
    /** Product URL */
    url: string;
    /** Message body */
    body?: string;
    /** Message footer */
    footer?: string;
    /** Array of buttons */
    buttons?: Button[];
    /** Price in smallest currency unit */
    priceAmount1000?: number;
    /** Currency code (default: "IDR") */
    currencyCode?: string;
}

// Album Message Types
export interface AlbumItem {
    /** Image content */
    image?: Buffer | { url: string };
    /** Video content */
    video?: Buffer | { url: string };
    /** Caption */
    caption?: string;
    /** MIME type */
    mimetype?: string;
    /** File name */
    fileName?: string;
}

// Event Message Types
export interface EventMessage {
    /** Event name */
    name: string;
    /** Event description */
    description: string;
    /** Location data */
    location?: {
        degreesLatitude: number;
        degreesLongitude: number;
        name: string;
    };
    /** Join link */
    joinLink?: string;
    /** Start time (timestamp or string) */
    startTime?: number | string;
    /** End time (timestamp or string) */
    endTime?: number | string;
    /** Is event canceled? */
    isCanceled?: boolean;
    /** Are extra guests allowed? */
    extraGuestsAllowed?: boolean;
}

// Poll Result Types
export interface PollVote {
    /** Option name */
    optionName: string;
    /** Vote count */
    optionVoteCount: number | string;
}

export interface PollResultMessage {
    /** Poll name */
    name: string;
    /** Poll votes */
    pollVotes: PollVote[];
}

// Request Payment Types
export interface RequestPaymentMessage {
    /** Amount in smallest currency unit */
    amount: number;
    /** Currency code (default: "IDR") */
    currency?: string;
    /** Expiry timestamp */
    expiry?: number;
    /** Sender JID */
    from?: string;
    /** Payment note */
    note?: string;
    /** Sticker message */
    sticker?: {
        stickerMessage: any;
    };
    /** Background color */
    background?: {
        id: string;
        placeholderArgb: number;
    };
}

// Main XMes Options
export interface XMesOptions {
    /** Target JID */
    jid: string;
    /** Message type */
    type: 
        | 'location'
        | 'payment_list'
        | 'interactive'
        | 'product'
        | 'album'
        | 'event'
        | 'poll_result'
        | 'request_payment';
    /** Message content based on type */
    content: 
        | { locationMessage: LocationMessage }
        | { paymentListMessage: PaymentListMessage }
        | { interactiveMessage: InteractiveMessage }
        | { productMessage: ProductMessage }
        | { albumMessage: AlbumItem[] }
        | { eventMessage: EventMessage }
        | { pollResultMessage: PollResultMessage }
        | { requestPaymentMessage: RequestPaymentMessage };
    /** Quoted message info */
    quoted?: {
        /** Message key */
        key: {
            /** Message ID */
            id?: string;
            /** Participant JID */
            participant?: string;
            /** Remote JID */
            remoteJid?: string;
            /** Is from me? */
            fromMe?: boolean;
        };
        /** Quoted message content */
        message?: any;
    };
    /** Additional options */
    options?: {
        /** Upload function */
        upload?: any;
        /** User JID */
        userJid?: string;
        /** Message ID */
        messageId?: string;
        /** Ephemeral message? */
        ephemeral?: boolean;
        /** Disappearing message duration in seconds */
        disappearing?: number;
        /** Media caption */
        caption?: string;
        /** Forwarded message? */
        forwarded?: boolean;
        /** Message timestamp */
        timestamp?: number;
    };
}

// Starx Class Types
export interface StarxConstructor {
    new (utils: any, waUploadToServer: any, relayMessageFn: any): Starx;
}

export interface Starx {
    /** Detect message type from content */
    detectType(content: any): string | null;
    
    /** Handle payment messages */
    handlePayment(content: any, quoted?: any): Promise<any>;
    
    /** Handle product messages */
    handleProduct(content: any, jid: string, quoted?: any): Promise<any>;
    
    /** Handle interactive messages */
    handleInteractive(content: any, jid: string, quoted?: any): Promise<any>;
    
    /** Handle album messages */
    handleAlbum(content: any, jid: string, quoted?: any): Promise<any>;
    
    /** Handle event messages */
    handleEvent(content: any, jid: string, quoted?: any): Promise<any>;
    
    /** Handle poll result messages */
    handlePollResult(content: any, jid: string, quoted?: any): Promise<any>;
    
    /** Handle location messages (NEW) */
    handleLocation(content: any, jid: string, quoted?: any): Promise<any>;
    
    /** Handle payment list messages (NEW) */
    handlePayList(content: any, jid: string, quoted?: any): Promise<any>;
    
    /** Process buttons helper (private) */
    private processButtons(buttons?: Button[]): {
        nativeFlowButtons: any[];
        interactiveButtons: any[];
    };
}

// Export the Starx class
export const Starx: StarxConstructor;
export default Starx;

// Utility Types
export interface MediaUploadResult {
    /** Uploaded media URL */
    url: string;
    /** Media type */
    type: string;
    /** Media size */
    size: number;
    /** Media hash */
    sha256: Buffer;
    /** Media key */
    mediaKey: Buffer;
    /** Media key timestamp */
    mediaKeyTimestamp: number;
    /** Direct path */
    directPath: string;
    /** Media info */
    mediaInfo?: any;
}

export interface MessageGenerationOptions {
    /** Upload function */
    upload?: (data: Buffer, options?: any) => Promise<MediaUploadResult>;
    /** User JID */
    userJid?: string;
    /** Message timestamp */
    timestamp?: number;
    /** Message ID */
    messageId?: string;
    /** Quoted message */
    quoted?: any;
    /** Ephemeral settings */
    ephemeral?: boolean | number;
    /** Additional context */
    contextInfo?: any;
}

// Response Types
export interface XMesResponse {
    /** Generated message */
    message: WAMessage;
    /** Message key */
    key: {
        remoteJid: string;
        fromMe: boolean;
        id: string;
        participant?: string;
    };
    /** Message timestamp */
    timestamp: number;
    /** Message status */
    status: 'sent' | 'delivered' | 'read' | 'failed';
    /** Additional data */
    data?: any;
}

// Error Types
export interface XMesError extends Error {
    /** Error code */
    code: 
        | 'INVALID_TYPE'
        | 'INVALID_CONTENT'
        | 'UPLOAD_FAILED'
        | 'BUTTON_INVALID'
        | 'PAYMENT_INVALID'
        | 'LOCATION_INVALID'
        | 'MEDIA_INVALID';
    /** Error details */
    details?: any;
}

// WhatsApp Protocol Extensions
declare module '../../WAProto' {
    namespace proto {
        namespace Message {
            interface InteractiveMessage {
                /** Native flow buttons */
                nativeFlowMessage?: {
                    buttons: Array<{
                        name: string;
                        buttonParamsJson: string;
                    }>;
                };
                /** Context info with payment list */
                contextInfo?: {
                    paymentList?: {
                        title: string;
                        description: string;
                        currencyCode: string;
                        paymentMethods: Array<{
                            id: string;
                            name: string;
                            description: string;
                            amount: number;
                            currency: string;
                            logo?: any;
                            isRecommended: boolean;
                        }>;
                    };
                } & any;
            }
            
            interface LocationMessage {
                /** Context info with buttons */
                contextInfo?: {
                    nativeFlowMessage?: {
                        buttons: any[];
                    };
                    buttons?: any[];
                    caption?: string;
                } & any;
            }
        }
    }
}
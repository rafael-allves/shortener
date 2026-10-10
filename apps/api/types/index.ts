export type SuccessResponse<T> = {
    success: true;
    message?: string;
    data: T;
    timestamp: string;
    pagination?: {
        page: number;
        limit: number;
        total: number;
        pages: number;
    };
};

export type ErrorResponse = {
    success: false;
    message: string;
    error: {
        message: string;
        code?: string;
        details?: any;
    };
    timestamp: string;
};
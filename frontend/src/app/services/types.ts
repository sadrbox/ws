// 1. БАЗОВЫЕ ТИПЫ ДЛЯ ВСЕХ СУЩНОСТЕЙ
export interface BaseEntity {
	id: string | number;
	createdAt: string | Date;
	updatedAt: string | Date;
	deletedAt?: string | Date;
}

// 2. ТИП ДЛЯ ПОЛЬЗОВАТЕЛЯ
export interface User extends BaseEntity {
	email: string;
	username: string;
	firstName: string;
	lastName: string;
	avatar?: string;
	role: "admin" | "user" | "moderator";
	isActive: boolean;
	lastLoginAt?: string;
}

// 3. ТИП ДЛЯ ПРОДУКТА
export interface Product extends BaseEntity {
	name: string;
	description: string;
	price: number;
	category: string;
	sku: string;
	stock: number;
	images: string[];
	attributes: Record<string, any>;
	isFeatured: boolean;
	rating?: number;
}

// 4. ТИП ДЛЯ ЗАКАЗА
export interface Order extends BaseEntity {
	userId: number;
	orderNumber: string;
	items: OrderItem[];
	subtotal: number;
	tax: number;
	shipping: number;
	total: number;
	status: OrderStatus;
	shippingAddress: Address;
	billingAddress: Address;
	paymentMethod: string;
	paymentStatus: PaymentStatus;
	notes?: string;
}

export interface OrderItem {
	productId: number;
	quantity: number;
	price: number;
	name: string;
}

export type OrderStatus =
	| "pending"
	| "processing"
	| "shipped"
	| "delivered"
	| "cancelled"
	| "refunded";

export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";

// 5. ТИП ДЛЯ АДРЕСА
export interface Address {
	street: string;
	city: string;
	state: string;
	country: string;
	zipCode: string;
	isDefault: boolean;
}

// 6. ПАРАМЕТРЫ ЗАПРОСА
export interface PaginationParams {
	page: number;
	limit: number;
	offset?: number;
}

export interface FilterParams {
	[key: string]: any;
}

export interface SortParams {
	field: string;
	direction: "asc" | "desc";
}

export interface SearchParams {
	query: string;
	fields?: string[];
	operator?: "and" | "or";
}

// 7. ОТВЕТ С ПАГИНАЦИЕЙ
export interface PaginatedResponse<T> {
	data: T[];
	meta: {
		total: number;
		page: number;
		limit: number;
		totalPages: number;
		hasNextPage: boolean;
		hasPrevPage: boolean;
		nextPage: number | null;
		prevPage: number | null;
	};
}

// 8. ОТВЕТ С ОШИБКОЙ
export interface ApiErrorResponse {
	statusCode: number;
	message: string;
	error?: string;
	errors?: Record<string, string[]>;
	timestamp: string;
	path: string;
}

// 9. ТИП ДЛЯ ФОРМ ДАННЫХ
export type CreateUserDto = Omit<User, keyof BaseEntity>;
export type UpdateUserDto = Partial<CreateUserDto>;

export type CreateProductDto = Omit<Product, keyof BaseEntity>;
export type UpdateProductDto = Partial<CreateProductDto>;

export type CreateOrderDto = Omit<Order, keyof BaseEntity | "orderNumber">;
export type UpdateOrderDto = Partial<CreateOrderDto>;

// 10. ТИП ДЛЯ ФИЛЬТРОВ
export interface UserFilters {
	role?: User["role"];
	isActive?: boolean;
	search?: string;
	createdAtFrom?: string;
	createdAtTo?: string;
}

export interface ProductFilters {
	category?: string;
	priceMin?: number;
	priceMax?: number;
	inStock?: boolean;
	isFeatured?: boolean;
	search?: string;
}

export interface OrderFilters {
	status?: OrderStatus;
	paymentStatus?: PaymentStatus;
	userId?: number;
	dateFrom?: string;
	dateTo?: string;
}

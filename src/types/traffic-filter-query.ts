export interface TrafficFilterQuery {
  q?: string;
  methods?: string[];
  status?: number;
  statusClass?: number;
  sort?: "asc" | "desc";
  limit?: number;
}

import "@/index.css";
import { CustomerManagementPage } from "./CustomerManagementPage";

export default {
  title: "CRM/Customer Management",
};

export const AllCustomers = () => <CustomerManagementPage mode="all" />;

export const ConsultingQueue = () => <CustomerManagementPage mode="consulting" />;

export const ContractManagement = () => <CustomerManagementPage mode="contract" />;

export const DeliveryManagement = () => <CustomerManagementPage mode="delivery" />;

export const Settlement = () => <CustomerManagementPage mode="settlement" />;

export const HoldAndChurn = () => <CustomerManagementPage mode="hold" />;

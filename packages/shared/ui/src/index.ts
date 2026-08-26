export {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from './ui/accordion';
export { Alert, AlertTitle, AlertDescription } from './ui/alert';
export { Avatar, AvatarImage, AvatarFallback } from './ui/avatar';
export { Badge, badgeVariants } from './ui/badge';
export { Button, buttonVariants } from './ui/button';
export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
} from './ui/card';
export { Checkbox } from './ui/checkbox';
export {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from './ui/collapsible';
export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
} from './ui/dropdown-menu';
export { Input } from './ui/input';
export { Label } from './ui/label';
export {
  navigationMenuTriggerStyle,
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuContent,
  NavigationMenuTrigger,
  NavigationMenuLink,
  NavigationMenuIndicator,
  NavigationMenuViewport,
} from './ui/navigation-menu';
export { Progress } from './ui/progress';
export { RadioGroup, RadioGroupItem } from './ui/radio-group';
export { ScrollArea, ScrollBar } from './ui/scroll-area';
export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
} from './ui/select';
export { Separator } from './ui/separator';
export { Switch } from './ui/switch';
export { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
export { Textarea } from './ui/textarea';
export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from './ui/tooltip';

export { MarkdownContent } from './widgets/markdown-content';
export { SearchBar } from './widgets/search-bar';
export { MessageInput } from './widgets/message-input';
export { LoadingSpinner } from './widgets/loading-spinner';
export { UserManagement } from './widgets/user-management';
export {
  UserDetailedManagement,
  type UserManagementUser,
} from './widgets/user-detailed-management';

// Auth forms and the signed-in menu. Presentational and prop-driven, so the
// package takes no `@acme/auth` dependency (ADR 0010) — the caller owns the
// provider call and passes `error` / `pending` back in.
export { SignInForm } from './widgets/sign-in-form';
export { SignUpForm } from './widgets/sign-up-form';
export { UserButton, type UserButtonUser } from './widgets/user-button';
export {
  MIN_PASSWORD_LENGTH,
  type SignInCredentials,
  type SignUpCredentials,
} from './lib/auth-credentials';

export { ToastThemeClient } from './providers/toast-theme-client';
// The theme wrapper module owns the `next-themes` dependency — it exports the
// provider and re-exports the hook, so apps read `resolvedTheme` through the
// same seam instead of depending on next-themes directly.
export { NextThemeProvider, useTheme } from './providers/theme-provider';

export { StripeIcon } from './icons/stripe-icon';

export {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from './ui/breadcrumb';

export { Skeleton } from './ui/skeleton';

export {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
  SheetClose,
} from './ui/sheet';

export {
  Sidebar,
  SidebarTrigger,
  SidebarProvider,
  useSidebar,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuAction,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarMenuItem,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarInset,
} from './ui/sidebar';

export { useIsMobile } from './ui/hooks/use-mobile';
export { cn } from './lib/utils';

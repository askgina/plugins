import * as React from "react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Slot } from "@radix-ui/react-slot";

import { cn } from "../../lib/utils";

export type DialogRootProps = React.ComponentPropsWithoutRef<typeof BaseDialog.Root>;
type DialogRootChangeDetails = Parameters<NonNullable<DialogRootProps["onOpenChange"]>>[1];

type DialogPointerDownOutsideEvent = {
  nativeEvent: DialogRootChangeDetails["event"];
  target: EventTarget | null;
  preventDefault: () => void;
  isDefaultPrevented: () => boolean;
};

type DialogPointerDownOutsideHandler = (event: DialogPointerDownOutsideEvent) => void;

type DialogContextValue = {
  addPointerDownOutsideHandler: (handler: DialogPointerDownOutsideHandler) => () => void;
  addTrapFocusDisabledContent: () => () => void;
};

const DialogContext = React.createContext<DialogContextValue | null>(null);

const createPointerDownOutsideEvent = (
  nativeEvent: DialogRootChangeDetails["event"],
): DialogPointerDownOutsideEvent => {
  let defaultPrevented = false;

  return {
    nativeEvent,
    target: nativeEvent.target,
    preventDefault: () => {
      defaultPrevented = true;
    },
    isDefaultPrevented: () => defaultPrevented,
  };
};

const DialogRoot = ({ onOpenChange, children, ...props }: DialogRootProps) => {
  const pointerDownOutsideHandlersRef = React.useRef<Set<DialogPointerDownOutsideHandler>>(
    new Set(),
  );
  const [trapFocusDisabledContentCount, setTrapFocusDisabledContentCount] = React.useState(0);
  const { modal, ...rootProps } = props;

  const addPointerDownOutsideHandler = React.useCallback(
    (handler: DialogPointerDownOutsideHandler) => {
      pointerDownOutsideHandlersRef.current.add(handler);

      return () => {
        pointerDownOutsideHandlersRef.current.delete(handler);
      };
    },
    [],
  );

  const addTrapFocusDisabledContent = React.useCallback(() => {
    setTrapFocusDisabledContentCount((count) => count + 1);

    return () => {
      setTrapFocusDisabledContentCount((count) => Math.max(0, count - 1));
    };
  }, []);

  const handleOpenChange = React.useCallback(
    (open: boolean, details: DialogRootChangeDetails) => {
      if (!open && details.reason === "outside-press") {
        const event = createPointerDownOutsideEvent(details.event);

        for (const handler of Array.from(pointerDownOutsideHandlersRef.current).reverse()) {
          handler(event);
        }

        if (event.isDefaultPrevented()) {
          details.cancel();
          return;
        }
      }

      onOpenChange?.(open, details);
    },
    [onOpenChange],
  );

  const contextValue = React.useMemo(
    () => ({ addPointerDownOutsideHandler, addTrapFocusDisabledContent }),
    [addPointerDownOutsideHandler, addTrapFocusDisabledContent],
  );

  const effectiveModal = trapFocusDisabledContentCount > 0 ? false : modal;

  return (
    <DialogContext.Provider value={contextValue}>
      <BaseDialog.Root onOpenChange={handleOpenChange} modal={effectiveModal} {...rootProps}>
        {children}
      </BaseDialog.Root>
    </DialogContext.Provider>
  );
};
DialogRoot.displayName = "DialogRoot";

type DialogTriggerProps = React.ComponentPropsWithoutRef<typeof BaseDialog.Trigger> & {
  asChild?: boolean;
};

const DialogTrigger = React.forwardRef<HTMLButtonElement, DialogTriggerProps>(
  ({ asChild = false, render, ...props }, ref) => (
    <BaseDialog.Trigger ref={ref} render={asChild ? <Slot /> : render} {...props} />
  ),
);
DialogTrigger.displayName = "DialogTrigger";

const DialogPortal = React.forwardRef<
  React.ElementRef<typeof BaseDialog.Portal>,
  React.ComponentPropsWithoutRef<typeof BaseDialog.Portal>
>(({ children, ...props }, ref) => (
  <BaseDialog.Portal ref={ref} {...props}>
    {children}
  </BaseDialog.Portal>
));
DialogPortal.displayName = "DialogPortal";

const DialogBackdrop = React.forwardRef<
  React.ElementRef<typeof BaseDialog.Backdrop>,
  React.ComponentPropsWithoutRef<typeof BaseDialog.Backdrop>
>(({ className, ...props }, ref) => (
  <BaseDialog.Backdrop
    ref={ref}
    className={cn(
      "fixed inset-0 z-[100] bg-grayscale-1/80 dark:bg-grayscale-1/80",
      "opacity-100 transition-opacity duration-200 ease-out data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 data-[ending-style]:duration-150 data-[ending-style]:ease-in",
      className,
    )}
    {...props}
  />
));
DialogBackdrop.displayName = "DialogBackdrop";

const DialogOverlay = DialogBackdrop;

const DialogViewport = React.forwardRef<
  React.ElementRef<typeof BaseDialog.Viewport>,
  React.ComponentPropsWithoutRef<typeof BaseDialog.Viewport>
>(({ className, ...props }, ref) => (
  <BaseDialog.Viewport
    ref={ref}
    className={cn("fixed inset-0 z-[100] overflow-y-auto", className)}
    {...props}
  />
));
DialogViewport.displayName = "DialogViewport";

type DialogPopupProps = React.ComponentPropsWithoutRef<typeof BaseDialog.Popup>;

const DialogPopup = React.forwardRef<React.ElementRef<typeof BaseDialog.Popup>, DialogPopupProps>(
  ({ className, ...props }, ref) => (
    <BaseDialog.Popup
      ref={ref}
      className={cn(
        "modal-shadow fixed left-[50%] top-[50%] z-[100] grid w-[calc(100%-2rem)] max-w-lg [transform:translate(-50%,-50%)] gap-4 rounded-[12px] border border-grayscale-3 bg-white p-2 font-sans opacity-100 [translate:0_0] transition-[opacity,translate] duration-150 ease-out data-[starting-style]:opacity-0 data-[starting-style]:[translate:0_8px] data-[ending-style]:opacity-0 data-[ending-style]:[translate:0_8px] data-[ending-style]:ease-in sm:w-full dark:border-grayscale-4 dark:bg-grayscale-2",
        className,
      )}
      {...props}
    />
  ),
);
DialogPopup.displayName = "DialogPopup";

type DialogContentProps = DialogPopupProps & {
  trapFocus?: boolean;
  onPointerDownOutside?: DialogPointerDownOutsideHandler;
  portalProps?: React.ComponentPropsWithoutRef<typeof BaseDialog.Portal>;
  backdropClassName?: string;
};

const DialogContent = React.forwardRef<
  React.ElementRef<typeof BaseDialog.Popup>,
  DialogContentProps
>(
  (
    {
      children,
      trapFocus,
      initialFocus,
      onPointerDownOutside,
      portalProps,
      backdropClassName,
      ...props
    },
    ref,
  ) => {
    const dialogContext = React.useContext(DialogContext);

    React.useEffect(() => {
      if (trapFocus !== false) {
        return;
      }

      return dialogContext?.addTrapFocusDisabledContent();
    }, [dialogContext, trapFocus]);

    React.useEffect(() => {
      if (!onPointerDownOutside) {
        return;
      }

      return dialogContext?.addPointerDownOutsideHandler(onPointerDownOutside);
    }, [dialogContext, onPointerDownOutside]);

    return (
      <DialogPortal {...portalProps}>
        <DialogBackdrop className={backdropClassName} />
        <DialogPopup ref={ref} initialFocus={trapFocus === false ? false : initialFocus} {...props}>
          {children}
        </DialogPopup>
      </DialogPortal>
    );
  },
);
DialogContent.displayName = "DialogContent";

type DialogCloseProps = React.ComponentPropsWithoutRef<typeof BaseDialog.Close> & {
  asChild?: boolean;
};

const DialogClose = React.forwardRef<HTMLButtonElement, DialogCloseProps>(
  ({ asChild = false, render, ...props }, ref) => (
    <BaseDialog.Close ref={ref} render={asChild ? <Slot /> : render} {...props} />
  ),
);
DialogClose.displayName = "DialogClose";

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof BaseDialog.Title>,
  React.ComponentPropsWithoutRef<typeof BaseDialog.Title>
>(({ className, ...props }, ref) => (
  <BaseDialog.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = "DialogTitle";

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof BaseDialog.Description>,
  React.ComponentPropsWithoutRef<typeof BaseDialog.Description>
>(({ className, ...props }, ref) => (
  <BaseDialog.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = "DialogDescription";

const createDialogHandle = BaseDialog.createHandle;
const DialogHandle = BaseDialog.Handle;

const Dialog = {
  Root: DialogRoot,
  Trigger: DialogTrigger,
  Portal: DialogPortal,
  Backdrop: DialogBackdrop,
  Overlay: DialogOverlay,
  Viewport: DialogViewport,
  Popup: DialogPopup,
  Content: DialogContent,
  Close: DialogClose,
  Header: DialogHeader,
  Footer: DialogFooter,
  Title: DialogTitle,
  Description: DialogDescription,
  createHandle: createDialogHandle,
  Handle: DialogHandle,
};

export type { DialogPointerDownOutsideEvent };
export {
  Dialog,
  DialogRoot,
  DialogPortal,
  DialogBackdrop,
  DialogOverlay,
  DialogViewport,
  DialogPopup,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  createDialogHandle,
  DialogHandle,
};
export default Dialog;
